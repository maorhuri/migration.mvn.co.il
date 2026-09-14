package agentless

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/textproto"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jlaffaye/ftp"
)

const ftpTimeout = 30 * time.Second

// ftpConn wraps an FTP control connection.
type ftpConn struct {
	c     *ftp.ServerConn
	cwd   string // directory after login
	logFn LogFunc
}

// ftpDial connects and logs in (passive mode, explicit FTPS when configured).
func ftpDial(ctx context.Context, cfg *Config, logFn LogFunc) (*ftpConn, error) {
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	opts := []ftp.DialOption{
		ftp.DialWithContext(ctx),
		ftp.DialWithTimeout(ftpTimeout),
		ftp.DialWithShutTimeout(10 * time.Second),
	}
	if cfg.FTPS {
		opts = append(opts, ftp.DialWithExplicitTLS(&tls.Config{ServerName: cfg.Host, InsecureSkipVerify: true, MinVersion: tls.VersionTLS12})) //nolint:gosec // customer FTP servers rarely have valid certificates
	}
	c, err := ftp.Dial(addr, opts...)
	if err != nil {
		if cfg.FTPS {
			return nil, fmt.Errorf("FTPS connection to %s failed: %w", addr, err)
		}
		return nil, fmt.Errorf("FTP connection to %s failed: %w", addr, err)
	}
	if err := c.Login(cfg.Username, cfg.Password); err != nil {
		c.Quit()
		return nil, fmt.Errorf("FTP login as %s on %s failed: %w", cfg.Username, addr, err)
	}
	cwd, err := c.CurrentDir()
	if err != nil || cwd == "" {
		cwd = "/"
	}
	return &ftpConn{c: c, cwd: cwd, logFn: logFn}, nil
}

func (f *ftpConn) close() {
	if f == nil || f.c == nil {
		return
	}
	f.c.Quit()
	f.c = nil
}

// docrootCandidates lists the directories to inspect, in order, relative to the login
// directory and (when that is not the root) to the FTP root as well.
func docrootCandidates(base, host string) []string {
	rel := []string{"", "public_html", "httpdocs", "www", "htdocs"}
	if host != "" {
		rel = append(rel, path.Join("domains", host, "public_html"), path.Join(host, "public_html"))
		if strings.HasPrefix(host, "www.") {
			bare := strings.TrimPrefix(host, "www.")
			rel = append(rel, path.Join("domains", bare, "public_html"), path.Join(bare, "public_html"))
		}
	}
	var out []string
	seen := map[string]bool{}
	add := func(p string) {
		p = path.Clean(p)
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	base = path.Clean("/" + strings.TrimPrefix(base, "/"))
	for _, r := range rel {
		add(path.Join(base, r))
	}
	if base != "/" {
		for _, r := range rel {
			add(path.Join("/", r))
		}
	}
	return out
}

// listing is a directory listing keyed by entry name.
type listing map[string]*ftp.Entry

func (f *ftpConn) list(dir string) (listing, error) {
	entries, err := f.c.List(dir)
	if err != nil {
		return nil, err
	}
	l := listing{}
	for _, e := range entries {
		if e.Name == "." || e.Name == ".." {
			continue
		}
		l[e.Name] = e
	}
	return l, nil
}

func (l listing) hasFile(name string) bool {
	e, ok := l[name]
	return ok && e.Type != ftp.EntryTypeFolder
}

// findDocroot locates the website's document root: the first candidate containing
// wp-config.php (candidates, then one level of sub-directories), else the first candidate
// with an index file. It returns the path, whether wp-config.php was found and the paths checked.
func (f *ftpConn) findDocroot(ctx context.Context, host string) (string, bool, []string, error) {
	var checked []string
	cache := map[string]listing{}
	get := func(dir string) (listing, bool) {
		if l, ok := cache[dir]; ok {
			return l, l != nil
		}
		if ctx.Err() != nil {
			return nil, false
		}
		l, err := f.list(dir)
		if err != nil {
			cache[dir] = nil
			checked = append(checked, dir+" (unreadable)")
			return nil, false
		}
		cache[dir] = l
		checked = append(checked, dir)
		return l, true
	}

	candidates := docrootCandidates(f.cwd, host)
	for _, dir := range candidates {
		if l, ok := get(dir); ok && l.hasFile("wp-config.php") {
			return dir, true, checked, nil
		}
	}
	// one level of sub-directories of the login directory (and of the root)
	roots := []string{path.Clean("/" + strings.TrimPrefix(f.cwd, "/"))}
	if roots[0] != "/" {
		roots = append(roots, "/")
	}
	subdirs := 0
	for _, root := range roots {
		l, ok := get(root)
		if !ok {
			continue
		}
		names := make([]string, 0, len(l))
		for name := range l {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			if e := l[name]; e.Type != ftp.EntryTypeFolder || strings.HasPrefix(name, ".") {
				continue
			}
			if subdirs++; subdirs > 80 {
				break
			}
			dir := path.Join(root, name)
			if sl, ok := get(dir); ok && sl.hasFile("wp-config.php") {
				return dir, true, checked, nil
			}
		}
	}
	// not WordPress: the first well-known directory with an index file
	for _, dir := range candidates {
		l, ok := cache[dir]
		if !ok || l == nil {
			continue
		}
		for _, idx := range []string{"index.php", "index.html", "index.htm"} {
			if l.hasFile(idx) {
				return dir, false, checked, nil
			}
		}
	}
	if ctx.Err() != nil {
		return "", false, checked, ctx.Err()
	}
	return "", false, checked, fmt.Errorf("no wp-config.php or index file found on the FTP server (checked %s); set metadata.docroot to the website directory", strings.Join(checked, ", "))
}

// verifyDir checks that a configured docroot exists and reports whether it holds wp-config.php.
func (f *ftpConn) verifyDir(dir string) (bool, error) {
	l, err := f.list(dir)
	if err != nil {
		return false, fmt.Errorf("docroot %s is not readable over FTP: %w", dir, err)
	}
	return l.hasFile("wp-config.php"), nil
}

func (f *ftpConn) upload(remote string, data []byte) error {
	if err := f.c.Stor(remote, bytes.NewReader(data)); err != nil {
		return fmt.Errorf("upload of %s failed: %w", remote, err)
	}
	return nil
}

// deleteFile removes a file; a missing file is not an error.
func (f *ftpConn) deleteFile(remote string) error {
	err := f.c.Delete(remote)
	if err == nil || isFTPNotFound(err) {
		return nil
	}
	return err
}

// removeDir removes a directory tree; a missing directory is not an error.
func (f *ftpConn) removeDir(remote string) error {
	err := f.c.RemoveDirRecur(remote)
	if err == nil || isFTPNotFound(err) {
		return nil
	}
	return err
}

func isFTPNotFound(err error) bool {
	var perr *textproto.Error
	if errors.As(err, &perr) {
		return perr.Code == ftp.StatusFileUnavailable
	}
	msg := err.Error()
	return strings.Contains(msg, "550") || strings.Contains(strings.ToLower(msg), "no such file")
}

// readFile downloads a small remote file (up to limit bytes).
func (f *ftpConn) readFile(remote string, limit int64) ([]byte, error) {
	r, err := f.c.Retr(remote)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	r.SetDeadline(time.Now().Add(ftpTimeout))
	return io.ReadAll(io.LimitReader(r, limit))
}

var wpDefineRe = regexp.MustCompile(`define\s*\(\s*['"](DB_NAME|DB_USER|DB_PASSWORD|DB_HOST)['"]\s*,\s*['"]([^'"]*)['"]\s*\)`)

// wpConfigCredentials extracts the database settings from wp-config.php source.
func wpConfigCredentials(src []byte) map[string]string {
	out := map[string]string{}
	for _, m := range wpDefineRe.FindAllSubmatch(src, -1) {
		key := string(m[1])
		if _, done := out[key]; !done {
			out[key] = string(m[2])
		}
	}
	return out
}
