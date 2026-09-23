// Package cloudways exports applications from a Cloudways server over SSH using the server's
// Master Credentials (username master_xxxx + password, from the Cloudways console).
//
// Cloudways has no control-panel API reachable with those credentials, so everything is read
// from the filesystem: one "application" per site under ~/applications/<slug>/ (Cloudways
// symlinks ~/applications to /home/<server-id>.cloudwaysapps.com), with
//
//	conf/server.nginx        server_name <slug's *.cloudwaysapps.com hostname> <custom domains...>;
//	public_html/wp-config.php (or .env) the app's own database credentials
//	/etc/php/<ver>/fpm/pool.d/<slug>.conf   which PHP version the app runs on
//
// The master user is not root: the app's ssl/ and conf/fpm-pool.conf are unreadable, there
// are no mailboxes at all (Cloudways does not host email) and cron jobs live in the app
// user's crontab, so those are reported as not migrated rather than exported.
package cloudways

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/ssh"
	gossh "golang.org/x/crypto/ssh"
)

// Cloudways is a Cloudways server connected over SSH with its master credentials.
type Cloudways struct {
	sshClient *ssh.Client
	config    *common.ConnectionConfig
	connected bool
	homeDir   string
	logFn     func(level, message string)
}

// App is one Cloudways application as read from the server.
type App struct {
	Slug          string   // directory name under ~/applications, also the DB name and system user
	Hostnames     []string // every name the vhost answers to (server.nginx + server.apache)
	CloudwaysHost string   // the app's own *.cloudwaysapps.com hostname
	Primary       string   // customer-facing domain to register on the target (see chooseDomains)
	Aliases       []string // other custom domains of the same app (bare, without www.)
	IsWordPress   bool
	SiteURL       string // WordPress "home" option, when readable
	DB            dbCreds
	PHPVersion    string
	DiskMB        int64
	DBSizeMB      float64
	DBTables      int
}

type dbCreds struct {
	Name, User, Pass, Host, Prefix string
}

// New creates a Cloudways exporter
func New() *Cloudways {
	return &Cloudways{logFn: func(string, string) {}}
}

// SetLogger sets the migration log sink
func (c *Cloudways) SetLogger(fn func(level, message string)) {
	if fn != nil {
		c.logFn = fn
	}
}

func (c *Cloudways) logf(level, format string, args ...interface{}) {
	c.logFn(level, fmt.Sprintf(format, args...))
}

// Connect opens the SSH connection with the master credentials (password or, if one was
// installed for the master user, an SSH key) and checks that ~/applications exists.
func (c *Cloudways) Connect(ctx context.Context, config *common.ConnectionConfig, password string, privateKey []byte) error {
	client := ssh.NewClient()
	if err := client.Connect(ctx, config, password, privateKey); err != nil {
		return err
	}
	// SFTP is only the last-resort file transfer (tar over the SSH session comes first) and
	// Cloudways jails it to the master user's home anyway, so failing to open it is not fatal.
	if err := client.ConnectSFTP(); err != nil {
		c.logf("warn", "SFTP to %s is unavailable (%v); file transfer relies on tar over SSH only", config.Host, shortErr(err))
	}
	c.sshClient = client
	c.config = config
	home, err := client.RunCommand(ctx, "printf %s \"$HOME\"")
	if err != nil || strings.TrimSpace(home) == "" {
		client.Disconnect()
		return fmt.Errorf("could not read the home directory of %s: %v", config.Username, err)
	}
	c.homeDir = strings.TrimSpace(home)
	if _, err := client.RunCommand(ctx, "test -d \"$HOME/applications\""); err != nil {
		client.Disconnect()
		return fmt.Errorf("%s has no ~/applications directory: this does not look like a Cloudways server, or %s is not the server's master user", config.Host, config.Username)
	}
	c.connected = true
	return nil
}

// Disconnect closes the SSH connection
func (c *Cloudways) Disconnect() error {
	c.connected = false
	if c.sshClient != nil {
		return c.sshClient.Disconnect()
	}
	return nil
}

// TestConnection checks the connection is usable
func (c *Cloudways) TestConnection(ctx context.Context) error {
	if !c.connected {
		return fmt.Errorf("not connected")
	}
	_, err := c.sshClient.RunCommand(ctx, "test -d \"$HOME/applications\"")
	return err
}

// GetPanelType returns the panel type
func (c *Cloudways) GetPanelType() common.PanelType { return common.PanelTypeCloudways }

func (c *Cloudways) appDir(slug string) string {
	return c.homeDir + "/applications/" + slug
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

// discoverScript reads everything about every application (or just one) in a single SSH round
// trip; the output is a sequence of @@-tagged sections parsed by parseDiscovery.
func discoverScript(slug string) string {
	glob := "*/"
	if slug != "" {
		glob = shq(slug) + "/"
	}
	return fmt.Sprintf(`cd "$HOME/applications" 2>/dev/null || { echo "@@NOAPPS"; exit 0; }
for d in %s; do
  a="${d%%/}"
  [ -d "$a/public_html" ] || continue
  echo "@@APP $a"
  echo "@@NGINX"; cat "$a/conf/server.nginx" 2>/dev/null
  echo "@@APACHE"; grep -hE '^[[:space:]]*Server(Name|Alias)' "$a/conf/server.apache" 2>/dev/null
  echo "@@WPCONFIG"; grep -hE "DB_NAME|DB_USER|DB_PASSWORD|DB_HOST|table_prefix" "$a/public_html/wp-config.php" 2>/dev/null
  echo "@@ENV"; grep -hE '^DB_(DATABASE|USERNAME|PASSWORD|HOST|PORT)=' "$a/public_html/.env" "$a/.env" 2>/dev/null
  echo "@@PHP"; ls /etc/php/*/fpm/pool.d/"$a".conf 2>/dev/null
  echo "@@DU"; du -sm "$a/public_html" 2>/dev/null | cut -f1
done
echo "@@END"`, glob)
}

var (
	wpDefineRe  = regexp.MustCompile(`define\(\s*['"](DB_NAME|DB_USER|DB_PASSWORD|DB_HOST)['"]\s*,\s*['"]([^'"]*)['"]`)
	wpPrefixRe  = regexp.MustCompile(`\$table_prefix\s*=\s*['"]([^'"]*)['"]`)
	phpPoolRe   = regexp.MustCompile(`/etc/php/([0-9]+\.[0-9]+)/fpm/pool\.d/`)
	safeSQLName = regexp.MustCompile(`^[A-Za-z0-9_]+$`)
)

// parseDiscovery turns discoverScript's output into apps (domains not yet chosen).
func parseDiscovery(out string) ([]*App, error) {
	if strings.Contains(out, "@@NOAPPS") {
		return nil, fmt.Errorf("~/applications is missing on the server")
	}
	var apps []*App
	var cur *App
	section := ""
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		switch {
		case strings.HasPrefix(line, "@@APP "):
			cur = &App{Slug: strings.TrimSpace(strings.TrimPrefix(line, "@@APP "))}
			apps = append(apps, cur)
			section = ""
			continue
		case strings.HasPrefix(line, "@@"):
			section = strings.TrimPrefix(line, "@@")
			continue
		}
		if cur == nil || strings.TrimSpace(line) == "" {
			continue
		}
		switch section {
		case "NGINX":
			cur.Hostnames = append(cur.Hostnames, vhostNames(line, "server_name")...)
		case "APACHE":
			cur.Hostnames = append(cur.Hostnames, vhostNames(line, "ServerName", "ServerAlias")...)
		case "WPCONFIG":
			cur.IsWordPress = true
			if m := wpDefineRe.FindStringSubmatch(line); m != nil {
				switch m[1] {
				case "DB_NAME":
					cur.DB.Name = m[2]
				case "DB_USER":
					cur.DB.User = m[2]
				case "DB_PASSWORD":
					cur.DB.Pass = m[2]
				case "DB_HOST":
					cur.DB.Host = m[2]
				}
			} else if m := wpPrefixRe.FindStringSubmatch(line); m != nil {
				cur.DB.Prefix = m[1]
			}
		case "ENV":
			if cur.IsWordPress {
				continue // wp-config.php wins over a stray .env
			}
			key, val, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			val = strings.Trim(strings.TrimSpace(val), `"'`)
			switch strings.TrimSpace(key) {
			case "DB_DATABASE":
				cur.DB.Name = val
			case "DB_USERNAME":
				cur.DB.User = val
			case "DB_PASSWORD":
				cur.DB.Pass = val
			case "DB_HOST":
				if cur.DB.Host == "" {
					cur.DB.Host = val
				} else {
					cur.DB.Host = val + strings.TrimPrefix(cur.DB.Host, "localhost")
				}
			case "DB_PORT":
				if val != "" && val != "3306" {
					host := cur.DB.Host
					if host == "" {
						host = "localhost"
					}
					cur.DB.Host = host + ":" + val
				}
			}
		case "PHP":
			if m := phpPoolRe.FindStringSubmatch(line); m != nil && cur.PHPVersion == "" {
				cur.PHPVersion = m[1]
			}
		case "DU":
			if n, err := strconv.ParseInt(strings.TrimSpace(line), 10, 64); err == nil {
				cur.DiskMB = n
			}
		}
	}
	for _, a := range apps {
		a.Hostnames = uniqueLower(a.Hostnames)
		if a.DB.Name == "" || a.DB.User == "" {
			a.DB = dbCreds{} // half a credential set is no credential set
		}
	}
	return apps, nil
}

// vhostNames extracts the hostnames from one nginx "server_name a b c;" or apache
// "ServerName a" / "ServerAlias a b" line, ignoring a trailing "# comment".
func vhostNames(line string, directives ...string) []string {
	if i := strings.Index(line, "#"); i >= 0 {
		line = line[:i]
	}
	fields := strings.Fields(strings.TrimSuffix(strings.TrimSpace(line), ";"))
	if len(fields) < 2 {
		return nil
	}
	for _, d := range directives {
		if strings.EqualFold(fields[0], d) {
			var names []string
			for _, f := range fields[1:] {
				f = strings.ToLower(strings.TrimSuffix(f, ";"))
				if f != "" && f != "_" && !strings.ContainsAny(f, "*~^") {
					names = append(names, f)
				}
			}
			return names
		}
	}
	return nil
}

func uniqueLower(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		s = strings.ToLower(strings.TrimSpace(s))
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

// chooseDomains decides what the app is called on the target. Every Cloudways app answers to
// its own <app>-<server>-<id>.cloudwaysapps.com hostname plus whatever custom domains the
// operator mapped in the console (with their www. variants). The customer-facing name is the
// WordPress home URL's host when that is a custom domain, else the first custom domain from
// the vhost, else -- an app that was never given a domain -- the cloudwaysapps.com hostname
// itself (the operator will have to attach the real domain on the target later). Remaining
// custom domains become aliases; www. variants and the cloudwaysapps.com hostname never do
// (the target serves www. itself, and the cloudwaysapps.com name belongs to Cloudways).
func chooseDomains(a *App) {
	var custom []string
	for _, h := range a.Hostnames {
		if strings.HasSuffix(h, ".cloudwaysapps.com") {
			if a.CloudwaysHost == "" && !strings.HasPrefix(h, "www.") {
				a.CloudwaysHost = h
			}
			continue
		}
		custom = append(custom, strings.TrimPrefix(h, "www."))
	}
	custom = uniqueLower(custom)

	primary := ""
	if a.SiteURL != "" {
		if host := hostOf(a.SiteURL); host != "" && !strings.HasSuffix(host, ".cloudwaysapps.com") {
			primary = strings.TrimPrefix(host, "www.")
		}
	}
	if primary == "" && len(custom) > 0 {
		primary = custom[0]
	}
	if primary == "" {
		primary = a.CloudwaysHost
	}
	a.Primary = primary
	a.Aliases = nil
	for _, d := range custom {
		if d != primary {
			a.Aliases = append(a.Aliases, d)
		}
	}
}

func hostOf(rawURL string) string {
	s := strings.TrimSpace(rawURL)
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	if i := strings.Index(s, ":"); i >= 0 {
		s = s[:i]
	}
	return strings.ToLower(s)
}

// mysqlAuth builds the mysql/mysqldump CLI auth flags for the app's own credentials. A
// wp-config DB_HOST of "localhost:/run/mysqld/mysqld.sock" means a unix socket.
func (d dbCreds) mysqlAuth() string {
	args := []string{"-u", shq(d.User), "-p" + shq(d.Pass)}
	host := strings.TrimSpace(d.Host)
	switch {
	case host == "" || host == "localhost" || host == "127.0.0.1":
		args = append(args, "-h", "localhost")
	case strings.HasPrefix(host, "localhost:/"):
		args = append(args, "-S", shq(strings.TrimPrefix(host, "localhost:")))
	case strings.Contains(host, ":"):
		h, p, _ := strings.Cut(host, ":")
		args = append(args, "-h", shq(h), "-P", shq(p))
	default:
		args = append(args, "-h", shq(host))
	}
	return strings.Join(args, " ")
}

// enrichFromDB reads the WordPress home URL and the database size with the app's own
// credentials. Failures only mean less detail (no domain from WordPress, no DB size), never an
// error: the vhost still names the domains and the dump step reports a real credential problem.
func (c *Cloudways) enrichFromDB(ctx context.Context, a *App) {
	if a.DB.Name == "" || !safeSQLName.MatchString(a.DB.Name) {
		return
	}
	sql := fmt.Sprintf("SELECT 'size', ROUND(COALESCE(SUM(data_length+index_length),0)/1048576,1), COUNT(*) FROM information_schema.tables WHERE table_schema='%s'", a.DB.Name)
	if a.IsWordPress && safeSQLName.MatchString(a.DB.Prefix+"x") {
		sql += fmt.Sprintf("; SELECT 'home', option_value, '' FROM `%s`.`%soptions` WHERE option_name='home'", a.DB.Name, a.DB.Prefix)
	}
	out, err := c.sshClient.RunCommand(ctx, fmt.Sprintf("mysql %s -N -e %s 2>/dev/null", a.DB.mysqlAuth(), shq(sql)))
	if err != nil {
		c.logf("warn", "%s: could not query database %s with the credentials from its config (%v); domain and size are taken from the vhost only", a.Slug, a.DB.Name, shortErr(err))
		return
	}
	for _, line := range strings.Split(out, "\n") {
		f := strings.Split(strings.TrimRight(line, "\r"), "\t")
		if len(f) < 2 {
			continue
		}
		switch f[0] {
		case "size":
			a.DBSizeMB, _ = strconv.ParseFloat(strings.TrimSpace(f[1]), 64)
			if len(f) > 2 {
				a.DBTables, _ = strconv.Atoi(strings.TrimSpace(f[2]))
			}
		case "home":
			a.SiteURL = strings.TrimSpace(f[1])
		}
	}
}

// discover lists every application (slug == "") or one application.
func (c *Cloudways) discover(ctx context.Context, slug string) ([]*App, error) {
	if !c.connected {
		return nil, fmt.Errorf("not connected")
	}
	out, err := c.sshClient.RunCommand(ctx, discoverScript(slug))
	if err != nil {
		return nil, fmt.Errorf("reading applications failed: %v", err)
	}
	apps, err := parseDiscovery(out)
	if err != nil {
		return nil, err
	}
	for _, a := range apps {
		c.enrichFromDB(ctx, a)
		chooseDomains(a)
	}
	sort.Slice(apps, func(i, j int) bool { return apps[i].Primary < apps[j].Primary })
	return apps, nil
}

func (a *App) account() common.Account {
	acc := common.Account{
		Username:     a.Slug,
		Domain:       a.Primary,
		DiskUsage:    humanMB(a.DiskMB),
		PHPVersion:   a.PHPVersion,
		AddonDomains: a.Aliases,
		IsWordPress:  a.IsWordPress,
		Metadata:     map[string]string{"cloudways_host": a.CloudwaysHost},
	}
	if a.IsWordPress {
		acc.SiteType = "wordpress"
	}
	if a.SiteURL != "" {
		acc.Metadata["site_url"] = a.SiteURL
	}
	if a.DB.Name != "" {
		acc.Databases = []string{a.DB.Name}
		acc.DBCount = 1
		if a.DBSizeMB > 0 {
			acc.DBSize = fmt.Sprintf("%.1f MB", a.DBSizeMB)
		}
	}
	return acc
}

func humanMB(mb int64) string {
	if mb <= 0 {
		return ""
	}
	if mb >= 1024 {
		return fmt.Sprintf("%.1f GB", float64(mb)/1024)
	}
	return fmt.Sprintf("%d MB", mb)
}

// ListAccounts returns one account per application
func (c *Cloudways) ListAccounts(ctx context.Context) ([]common.Account, error) {
	apps, err := c.discover(ctx, "")
	if err != nil {
		return nil, err
	}
	accounts := make([]common.Account, 0, len(apps))
	for _, a := range apps {
		accounts = append(accounts, a.account())
	}
	return accounts, nil
}

// GetAccount returns one application by its slug
func (c *Cloudways) GetAccount(ctx context.Context, slug string) (*common.Account, error) {
	a, err := c.getApp(ctx, slug)
	if err != nil {
		return nil, err
	}
	acc := a.account()
	return &acc, nil
}

func (c *Cloudways) getApp(ctx context.Context, slug string) (*App, error) {
	if slug == "" || strings.ContainsAny(slug, "/ \t\n") || strings.HasPrefix(slug, ".") {
		return nil, fmt.Errorf("invalid application name %q", slug)
	}
	apps, err := c.discover(ctx, slug)
	if err != nil {
		return nil, err
	}
	if len(apps) == 0 {
		return nil, fmt.Errorf("application %s not found under ~/applications on %s", slug, c.config.Host)
	}
	return apps[0], nil
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

// ExportAccount exports one application: its domain(s), database dump and files, laid out
// the way the Enhance importer expects (files/domains/<domain>/public_html, databases/<db>.sql.gz).
func (c *Cloudways) ExportAccount(ctx context.Context, slug string, outputDir string, progress chan<- common.MigrationProgress) (*common.ExportData, error) {
	if !c.connected {
		return nil, fmt.Errorf("not connected")
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create output directory: %w", err)
	}
	a, err := c.getApp(ctx, slug)
	if err != nil {
		return nil, err
	}
	data := &common.ExportData{
		ExportedAt:  time.Now(),
		SourcePanel: common.PanelTypeCloudways,
		Account:     a.account(),
	}
	sendProgress := func(step string, completed, total int) {
		if progress != nil {
			progress <- common.MigrationProgress{Status: "running", CurrentStep: step, TotalSteps: total, CompletedSteps: completed}
		}
	}
	const totalSteps = 3

	// 1. Domains
	sendProgress("Exporting domains", 0, totalSteps)
	data.Domains = []common.Domain{{
		Name:         a.Primary,
		Type:         "main",
		DocumentRoot: "public_html",
		PHPVersion:   a.PHPVersion,
		Aliases:      a.Aliases,
	}}
	c.logf("info", "Application %s: domain %s (vhost: %s)%s, PHP %s, %s of files",
		a.Slug, a.Primary, strings.Join(a.Hostnames, " "), aliasNote(a.Aliases), orUnknown(a.PHPVersion), orUnknown(humanMB(a.DiskMB)))
	if a.Primary == a.CloudwaysHost {
		c.logf("warn", "%s has no custom domain mapped in Cloudways; it is migrated under its %s hostname -- attach the real domain on the target afterwards", a.Slug, a.CloudwaysHost)
	} else if a.SiteURL != "" && hostOf(a.SiteURL) != a.Primary && strings.TrimPrefix(hostOf(a.SiteURL), "www.") != a.Primary {
		c.logf("warn", "%s: WordPress home URL is %s but the site is migrated as %s; check siteurl/home after the import", a.Slug, a.SiteURL, a.Primary)
	}
	c.logf("info", "Cloudways hosts no mailboxes, and cron jobs and the SSL certificate of an app are not readable with master credentials: none of those are migrated (the target issues its own certificate)")

	// 2. Database
	sendProgress("Exporting databases", 1, totalSteps)
	dbs, err := c.ExportDatabases(ctx, slug, outputDir)
	if err != nil {
		return nil, fmt.Errorf("failed to export databases: %w", err)
	}
	data.Databases = dbs

	// 3. Files
	sendProgress("Exporting files", 2, totalSteps)
	if err := c.exportFiles(ctx, a, outputDir, progress); err != nil {
		return nil, fmt.Errorf("failed to export files: %w", err)
	}
	data.FilesPath = filepath.Join(outputDir, "files")

	f, err := os.Create(filepath.Join(outputDir, "export_data.json"))
	if err != nil {
		return nil, fmt.Errorf("failed to create metadata file: %w", err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(data); err != nil {
		return nil, fmt.Errorf("failed to write metadata: %w", err)
	}
	return data, nil
}

func aliasNote(aliases []string) string {
	if len(aliases) == 0 {
		return ""
	}
	return " + aliases " + strings.Join(aliases, ", ")
}

func orUnknown(s string) string {
	if s == "" {
		return "unknown"
	}
	return s
}

// ExportDatabases dumps the application's database with the credentials from its own config
// (the master user has no MySQL access of its own on Cloudways).
func (c *Cloudways) ExportDatabases(ctx context.Context, slug string, outputDir string) ([]common.Database, error) {
	a, err := c.getApp(ctx, slug)
	if err != nil {
		return nil, err
	}
	if a.DB.Name == "" {
		c.logf("warn", "%s: no database credentials found in public_html/wp-config.php or .env; no database is exported", a.Slug)
		return nil, nil
	}
	dbDir := filepath.Join(outputDir, "databases")
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create databases directory: %w", err)
	}

	// The dump is streamed straight from mysqldump's stdout over the SSH session into the local
	// file: nothing is written on the source. (A temp file + SFTP download, as the DirectAdmin
	// exporter does, does not work here: Cloudways jails the master user's SFTP to its home
	// directory, so a file the shell wrote under /tmp does not exist as far as SFTP is concerned.)
	// set -o pipefail keeps mysqldump's own exit status authoritative over gzip's.
	dumpCmd := fmt.Sprintf("set -o pipefail 2>/dev/null; mysqldump %s --single-transaction --quick --skip-lock-tables --routines --triggers --events --default-character-set=utf8mb4 %s | gzip -1",
		a.DB.mysqlAuth(), shq(a.DB.Name))
	localDump := filepath.Join(dbDir, a.DB.Name+".sql.gz")
	if err := c.streamToFile(ctx, dumpCmd, localDump); err != nil {
		os.Remove(localDump)
		return nil, fmt.Errorf("mysqldump of %s failed: %w", a.DB.Name, err)
	}

	st, err := os.Stat(localDump)
	if err != nil || st.Size() < 64 {
		return nil, fmt.Errorf("dump of %s is empty", a.DB.Name)
	}
	c.logf("info", "Database %s dumped: %.1f MB data in %d tables, %d bytes compressed", a.DB.Name, a.DBSizeMB, a.DBTables, st.Size())
	return []common.Database{{
		Name:    a.DB.Name,
		Type:    "mysql",
		Size:    int64(a.DBSizeMB * 1024 * 1024),
		Users:   []common.DBUser{{Username: a.DB.User, Host: "localhost"}},
		Charset: "utf8mb4",
	}}, nil
}

// streamToFile runs command on the source and writes its stdout to localPath as it arrives;
// stderr is kept for the error message. Cancelling ctx kills the remote command.
func (c *Cloudways) streamToFile(ctx context.Context, command, localPath string) error {
	client := c.sshClient.GetSSHClient()
	if client == nil {
		return fmt.Errorf("SSH connection not established")
	}
	sess, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to open SSH session: %w", err)
	}
	defer sess.Close()
	var stderr bytes.Buffer
	sess.Stderr = &stderr
	stdout, err := sess.StdoutPipe()
	if err != nil {
		return err
	}
	f, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := sess.Start(command); err != nil {
		return fmt.Errorf("failed to start remote command: %w", err)
	}
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			sess.Signal(gossh.SIGKILL)
			sess.Close()
		case <-done:
		}
	}()
	_, copyErr := io.Copy(f, stdout)
	waitErr := sess.Wait()
	close(done)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if waitErr != nil {
		return fmt.Errorf("%v: %s", waitErr, strings.TrimSpace(tail(stderr.String(), 600)))
	}
	if copyErr != nil {
		return fmt.Errorf("writing %s: %w", localPath, copyErr)
	}
	return nil
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "..." + s[len(s)-n:]
}

// ExportFiles downloads the application's public_html
func (c *Cloudways) ExportFiles(ctx context.Context, slug string, outputDir string, progress chan<- common.MigrationProgress) error {
	a, err := c.getApp(ctx, slug)
	if err != nil {
		return err
	}
	return c.exportFiles(ctx, a, outputDir, progress)
}

func (c *Cloudways) exportFiles(ctx context.Context, a *App, outputDir string, progress chan<- common.MigrationProgress) error {
	localDocRoot := filepath.Join(outputDir, "files", "domains", a.Primary, "public_html")
	if err := os.MkdirAll(localDocRoot, 0755); err != nil {
		return fmt.Errorf("failed to create local directory: %w", err)
	}
	const step = "Downloading files"
	if progress != nil {
		progress <- common.MigrationProgress{Status: "running", CurrentStep: step}
	}
	remote := c.appDir(a.Slug) + "/public_html"
	total, sizeErr := c.sshClient.RemoteDirSize(ctx, remote)
	if sizeErr != nil {
		c.logf("warn", "Could not measure %s up front (%v); progress is reported without a total", remote, shortErr(sizeErr))
	}
	reporter := common.NewTransferReporter(step, total, progress, func(level, msg string) { c.logf(level, "%s", msg) })
	reporter.Start()
	err := c.sshClient.RsyncDownloadWithKey(ctx, remote, localDocRoot, reporter.Feed())
	var partial *ssh.RsyncPartialError
	if asPartial(err, &partial) {
		c.logf("warn", "Some files changed or vanished on the source while copying; running a second pass. %s", partial.Tail)
		err = c.sshClient.RsyncDownloadWithKey(ctx, remote, localDocRoot, reporter.Feed())
		if asPartial(err, &partial) {
			c.logf("warn", "Files are still being rewritten on the source (cache/temp files); continuing with what was copied. %s", partial.Tail)
			err = nil
		}
	}
	reporter.Finish()
	if err != nil {
		return fmt.Errorf("failed to download %s: %w", remote, err)
	}
	c.disableCloudwaysDropIns(localDocRoot, a)
	return nil
}

// disableCloudwaysDropIns neutralises, in the staged copy, the WordPress drop-ins that only
// work on the Cloudways stack: wp-content/object-cache.php talks to the Redis/Memcached that
// Cloudways runs next to the app, and on a node without one it takes the whole site down
// (Object Cache Pro / Redis Object Cache fail hard on a refused connection). The page-cache
// drop-in (advanced-cache.php) is left alone: those plugins regenerate it and degrade
// gracefully. The file is renamed, not deleted, so it can be restored if the target has Redis.
func (c *Cloudways) disableCloudwaysDropIns(localDocRoot string, a *App) {
	if !a.IsWordPress {
		return
	}
	oc := filepath.Join(localDocRoot, "wp-content", "object-cache.php")
	if _, err := os.Stat(oc); err != nil {
		return
	}
	if err := os.Rename(oc, oc+".cloudways-disabled"); err != nil {
		c.logf("warn", "%s: could not disable wp-content/object-cache.php (%v); if the target has no Redis the site will not load until it is removed", a.Primary, err)
		return
	}
	c.logf("warn", "%s: wp-content/object-cache.php (Cloudways Redis object cache drop-in) was disabled in the copy -- renamed to object-cache.php.cloudways-disabled; re-enable it only if the target node runs Redis", a.Primary)
}

func asPartial(err error, target **ssh.RsyncPartialError) bool {
	if err == nil {
		return false
	}
	if p, ok := err.(*ssh.RsyncPartialError); ok {
		*target = p
		return true
	}
	return false
}

// ExportEmails: Cloudways hosts no mailboxes
func (c *Cloudways) ExportEmails(ctx context.Context, slug string, outputDir string) ([]common.EmailAccount, error) {
	return nil, nil
}

// CleanupTempFiles: the export leaves nothing behind on the source (dumps are streamed, not
// written there), so there is nothing to clean up.
func (c *Cloudways) CleanupTempFiles(ctx context.Context) error {
	return nil
}

func shq(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func shortErr(err error) string {
	s := err.Error()
	if len(s) > 160 {
		s = s[:160] + "..."
	}
	return s
}
