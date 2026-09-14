package security

import (
	"archive/zip"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var wpVersionRe = regexp.MustCompile(`\$wp_version\s*=\s*'([0-9][0-9A-Za-z.\-]*)'`)

// detectWPVersion reads wp-includes/version.php.
func detectWPVersion(docroot string) string {
	content, err := os.ReadFile(filepath.Join(docroot, "wp-includes", "version.php"))
	if err != nil {
		return ""
	}
	if m := wpVersionRe.FindSubmatch(content); m != nil {
		return string(m[1])
	}
	return ""
}

// fetchCoreChecksums returns the official md5 checksums of a WordPress release (cached on disk).
func fetchCoreChecksums(ctx context.Context, cacheDir, version string) (map[string]string, error) {
	var cachePath string
	if cacheDir != "" {
		cachePath = filepath.Join(cacheDir, "wp-core", "checksums-"+version+".json")
		if data, err := os.ReadFile(cachePath); err == nil {
			var m map[string]string
			if json.Unmarshal(data, &m) == nil && len(m) > 0 {
				return m, nil
			}
		}
	}
	url := "https://api.wordpress.org/core/checksums/1.0/?version=" + version + "&locale=en_US"
	rctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(rctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("wordpress.org unreachable: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	var payload struct {
		Checksums json.RawMessage `json:"checksums"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("unexpected checksum response: %w", err)
	}
	var m map[string]string
	if err := json.Unmarshal(payload.Checksums, &m); err != nil || len(m) == 0 {
		return nil, fmt.Errorf("no checksums published for WordPress %s", version)
	}
	if cachePath != "" {
		if err := os.MkdirAll(filepath.Dir(cachePath), 0755); err == nil {
			_ = os.WriteFile(cachePath, body[:0], 0644) // placeholder so a partial write never poisons the cache
			if enc, err := json.Marshal(m); err == nil {
				_ = os.WriteFile(cachePath, enc, 0644)
			}
		}
	}
	return m, nil
}

// checkCore compares the exported core files with the official checksums.
// Returns modified, extra and missing counts.
func (s *scanner) checkCore(domain, docroot string, checksums map[string]string) (int, int, int) {
	modified, extra, missing := 0, 0, 0
	for rel, want := range checksums {
		if strings.HasPrefix(rel, "wp-content/") {
			continue
		}
		abs := filepath.Join(docroot, filepath.FromSlash(rel))
		st, err := os.Stat(abs)
		if err != nil || st.IsDir() {
			missing++
			continue
		}
		got, err := md5File(abs)
		if err != nil {
			continue
		}
		if !strings.EqualFold(got, want) {
			modified++
			s.add(Finding{Severity: SevHigh, Category: "core_modified", Domain: domain, Path: rel, Action: ActionRestoreCore,
				Evidence: "md5 differs from the official WordPress release", Note: "cleaning restores the pristine file from wordpress.org"})
		}
	}
	// PHP files inside wp-admin / wp-includes that are not part of the release, and unknown root-level PHP files.
	for _, dir := range []string{"wp-admin", "wp-includes"} {
		root := filepath.Join(docroot, dir)
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			rel, _ := filepath.Rel(docroot, path)
			rel = filepath.ToSlash(rel)
			if _, ok := checksums[rel]; ok {
				return nil
			}
			if phpExt[strings.ToLower(filepath.Ext(rel))] {
				extra++
				s.add(Finding{Severity: SevCritical, Category: "core_extra", Domain: domain, Path: rel, Action: ActionQuarantine,
					Evidence: "PHP file that is not part of WordPress " + detectWPVersion(docroot), Note: "wp-admin/wp-includes must contain release files only"})
			}
			return nil
		})
	}
	if entries, err := os.ReadDir(docroot); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if !phpExt[strings.ToLower(filepath.Ext(name))] {
				continue
			}
			if _, ok := checksums[name]; ok {
				continue
			}
			if name == "wp-config.php" {
				continue
			}
			extra++
			s.add(Finding{Severity: SevHigh, Category: "root_unknown_php", Domain: domain, Path: name, Action: ActionReport,
				Evidence: "PHP file in the site root that is not part of WordPress", Note: "common names: wp-tmp.php, wp-feed.php, wp-cache-*.php; legitimate custom files exist too"})
		}
	}
	return modified, extra, missing
}

func md5File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// pristineCoreFile returns the bytes of one file from the official release archive (cached on disk).
func pristineCoreFile(ctx context.Context, cacheDir, version, rel string) ([]byte, error) {
	if cacheDir == "" {
		cacheDir = os.TempDir()
	}
	archive := filepath.Join(cacheDir, "wp-core", "wordpress-"+version+".zip")
	if _, err := os.Stat(archive); err != nil {
		if err := downloadFile(ctx, "https://wordpress.org/wordpress-"+version+".zip", archive); err != nil {
			return nil, fmt.Errorf("download WordPress %s: %w", version, err)
		}
	}
	zr, err := zip.OpenReader(archive)
	if err != nil {
		_ = os.Remove(archive)
		return nil, fmt.Errorf("open core archive: %w", err)
	}
	defer zr.Close()
	want := "wordpress/" + rel
	for _, f := range zr.File {
		if f.Name == want {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		}
	}
	return nil, fmt.Errorf("%s not in the WordPress %s archive", rel, version)
}

func downloadFile(ctx context.Context, url, dst string) error {
	rctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(rctx, "GET", url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, resp.Body); err != nil {
		out.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}
