package agentless

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/storage"
)

func noLog(string, string) {}

func init() { downloadBackoff = 5 * time.Millisecond }

func TestDocrootCandidatesOrder(t *testing.T) {
	got := docrootCandidates("/", "example.com")
	want := []string{"/", "/public_html", "/httpdocs", "/www", "/htdocs", "/domains/example.com/public_html", "/example.com/public_html"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("root candidates:\n got %v\nwant %v", got, want)
	}
	got = docrootCandidates("/home/user", "www.example.com")
	if got[0] != "/home/user" || got[1] != "/home/user/public_html" {
		t.Fatalf("login-dir candidates come first: %v", got)
	}
	if !contains(got, "/home/user/domains/example.com/public_html") || !contains(got, "/public_html") {
		t.Fatalf("bare host and root variants missing: %v", got)
	}
	seen := map[string]bool{}
	for _, c := range got {
		if seen[c] {
			t.Fatalf("duplicate candidate %s in %v", c, got)
		}
		seen[c] = true
	}
}

func contains(list []string, s string) bool {
	for _, e := range list {
		if e == s {
			return true
		}
	}
	return false
}

func TestReplacePlaceholders(t *testing.T) {
	src := []byte("<?php $t='__TOKEN__'; $ip='__ALLOWED_IP__'; $e=__EXPIRES__; $d='__DOCROOT__'; // __TOKEN__ again")
	exp := time.Unix(1700000000, 0)
	out := string(replacePlaceholders(src, helperConfig{Token: "abc123", AllowedIP: "1.2.3.4", Expires: exp, Docroot: ""}))
	if strings.Contains(out, "__") {
		t.Fatalf("placeholders left: %s", out)
	}
	for _, want := range []string{"$t='abc123'", "$ip='1.2.3.4'", "$e=1700000000", "$d=''", "// abc123 again"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in %s", want, out)
		}
	}
}

func TestBuildPluginZip(t *testing.T) {
	data, err := buildPluginZip(helperConfig{Token: strings.Repeat("a", 32), Expires: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		if bytes.Contains(b, []byte("__TOKEN__")) {
			t.Fatalf("%s still has __TOKEN__", f.Name)
		}
	}
	want := []string{"mvn-migrator/mvn-migrator.php", "mvn-migrator/mvn-agent.php"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("zip entries %v, want %v", names, want)
	}
}

func TestPartNamingAndGzipHandling(t *testing.T) {
	if got := localPartName(0, "files.tar.gz"); got != "part-000-files.tar.gz" {
		t.Fatalf("part name %q", got)
	}
	if got := localPartName(11, "../files.tar.gz.ab"); got != "part-011-files.tar.gz.ab" {
		t.Fatalf("part name must strip directories: %q", got)
	}
	dir := t.TempDir()
	raw := filepath.Join(dir, "db.sql")
	os.WriteFile(raw, []byte(strings.Repeat("INSERT INTO t VALUES (1);\n", 20)), 0o644)
	if isGzipFile(raw) {
		t.Fatal("plain sql detected as gzip")
	}
	final := filepath.Join(dir, "wp_db.sql.gz")
	if err := storeGzipped(raw, final); err != nil {
		t.Fatal(err)
	}
	if !isGzipFile(final) {
		t.Fatal("stored dump is not gzip")
	}
	gz := filepath.Join(dir, "db2.sql.gz")
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	w.Write([]byte("-- already compressed\n"))
	w.Close()
	os.WriteFile(gz, buf.Bytes(), 0o644)
	final2 := filepath.Join(dir, "wp_db2.sql.gz")
	if err := storeGzipped(gz, final2); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(final2)
	if !bytes.Equal(b, buf.Bytes()) {
		t.Fatal("compressed dump must be moved unchanged")
	}
}

// rangeServer serves one blob with Range support and can drop the first connection midway.
func rangeServer(t *testing.T, blob []byte, dropAfter int, ranges *int32) *httptest.Server {
	t.Helper()
	var first int32
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("action") != "get" || r.Header.Get("X-MT-Token") != "tok" {
			http.Error(w, `{"ok":false,"error":"bad token"}`, http.StatusForbidden)
			return
		}
		start := 0
		if rh := r.Header.Get("Range"); rh != "" {
			atomic.AddInt32(ranges, 1)
			fmt.Sscanf(rh, "bytes=%d-", &start)
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(blob)-1, len(blob)))
			w.Header().Set("Content-Length", strconv.Itoa(len(blob)-start))
			w.Header().Set("Content-Type", "application/octet-stream")
			w.WriteHeader(http.StatusPartialContent)
		} else {
			w.Header().Set("Content-Length", strconv.Itoa(len(blob)))
			w.Header().Set("Content-Type", "application/octet-stream")
			w.WriteHeader(http.StatusOK)
		}
		if atomic.CompareAndSwapInt32(&first, 0, 1) && dropAfter > 0 {
			w.Write(blob[start : start+dropAfter])
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			hj, ok := w.(http.Hijacker)
			if !ok {
				t.Fatal("no hijacker")
			}
			conn, _, _ := hj.Hijack()
			conn.Close()
			return
		}
		w.Write(blob[start:])
	}))
}

func TestDownloadResumesWithRange(t *testing.T) {
	blob := bytes.Repeat([]byte("0123456789abcdef"), 4096) // 64 KB
	var ranges int32
	srv := rangeServer(t, blob, 10000, &ranges)
	defer srv.Close()
	h := newHelper(srv.URL+"/mvn-x.php", false, "tok", noLog)
	dest := filepath.Join(t.TempDir(), "files.tar.gz")
	var last int64
	if err := h.download(context.Background(), "files.tar.gz", dest, int64(len(blob)), func(n int64) { last = n }); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(dest)
	if !bytes.Equal(got, blob) {
		t.Fatalf("content differs: %d bytes vs %d", len(got), len(blob))
	}
	if atomic.LoadInt32(&ranges) != 1 {
		t.Fatalf("expected exactly one Range request, got %d", ranges)
	}
	if last != int64(len(blob)) {
		t.Fatalf("progress ended at %d", last)
	}
}

func TestDownloadRejectsWrongSize(t *testing.T) {
	blob := []byte("short")
	var ranges int32
	srv := rangeServer(t, blob, 0, &ranges)
	defer srv.Close()
	h := newHelper(srv.URL+"/mvn-x.php", false, "tok", noLog)
	dest := filepath.Join(t.TempDir(), "f")
	err := h.download(context.Background(), "f", dest, 999, nil)
	if err == nil || !strings.Contains(err.Error(), "Content-Length") {
		t.Fatalf("expected a size mismatch error, got %v", err)
	}
}

func TestDecodeClassification(t *testing.T) {
	h := newHelper("https://example.com/mvn-x.php", false, "secret-token", noLog)
	cases := []struct {
		status int
		body   string
		want   interface{}
	}{
		{200, `{"ok":true,"php_version":"8.1.2"}`, nil},
		{200, "\xef\xbb\xbfWarning: foo\n{\"ok\":true}", nil},
		{403, `{"ok":false,"error":"bad token"}`, &ForbiddenError{}},
		{403, `<html>Forbidden</html>`, &UnreachableError{}},
		{404, `not found`, &UnreachableError{}},
		{200, `<?php echo "secret-token";`, &UnreachableError{}},
		{200, `{"ok":false,"error":"mysqli missing"}`, &HelperError{}},
		{200, `{"foo":1}`, &UnreachableError{}},
	}
	for i, c := range cases {
		_, err := h.decode("info", c.status, []byte(c.body))
		if c.want == nil {
			if err != nil {
				t.Fatalf("case %d: unexpected error %v", i, err)
			}
			continue
		}
		if err == nil {
			t.Fatalf("case %d: expected %T", i, c.want)
		}
		if reflect.TypeOf(err) != reflect.TypeOf(c.want) {
			t.Fatalf("case %d: got %T (%v), want %T", i, err, err, c.want)
		}
		if strings.Contains(err.Error(), "secret-token") {
			t.Fatalf("case %d: token leaked into the error: %v", i, err)
		}
	}
	hp := newHelper("https://example.com/wp-admin/admin-ajax.php", true, "t", noLog)
	if _, err := hp.decode("info", 400, []byte("0")); err == nil || !strings.Contains(err.Error(), "not registered") {
		t.Fatalf("plugin '0' answer: %v", err)
	}
}

func TestHelperURL(t *testing.T) {
	h := newHelper("https://example.com/mvn-x.php", false, "t0k", noLog)
	u := h.url("get", map[string]string{"file": "a b.tar.gz"})
	if !strings.HasPrefix(u, "https://example.com/mvn-x.php?") || !strings.Contains(u, "action=get") || !strings.Contains(u, "token=t0k") || !strings.Contains(u, "file=a+b.tar.gz") {
		t.Fatalf("url %s", u)
	}
	hp := newHelper("https://example.com/wp-admin/admin-ajax.php", true, "t0k", noLog)
	u = hp.url("dump", nil)
	if !strings.Contains(u, "action=mvn_migrator") || !strings.Contains(u, "mvn_action=dump") {
		t.Fatalf("plugin url %s", u)
	}
}

func makeTarGz(t *testing.T, entries map[string]string, compress bool) string {
	t.Helper()
	var buf bytes.Buffer
	var w io.WriteCloser = nopCloser{&buf}
	if compress {
		w = gzip.NewWriter(&buf)
	}
	tw := tar.NewWriter(w)
	for name, content := range entries {
		if strings.HasSuffix(name, "/") {
			tw.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Typeflag: tar.TypeDir, ModTime: time.Now()})
			continue
		}
		tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(content)), Typeflag: tar.TypeReg, ModTime: time.Now()})
		tw.Write([]byte(content))
	}
	tw.Close()
	w.Close()
	p := filepath.Join(t.TempDir(), "files.tar")
	if compress {
		p += ".gz"
	}
	os.WriteFile(p, buf.Bytes(), 0o644)
	return p
}

type nopCloser struct{ io.Writer }

func (nopCloser) Close() error { return nil }

func TestExtractArchiveAndStrip(t *testing.T) {
	if _, err := exec.LookPath("tar"); err != nil {
		t.Skip("tar not installed")
	}
	entries := map[string]string{
		"./wp-config.php":             "<?php define('DB_NAME','wp');",
		"./index.php":                 "<?php",
		"./wp-content/":               "",
		"./wp-content/uploads/a.txt":  "hello",
		"./.mvn-tmp-deadbeef/":        "",
		"./.mvn-tmp-deadbeef/state":   "{}",
		"./mvn-0123456789ab.php":      "<?php // helper",
		"./wp-content/themes/x/y.css": "body{}",
	}
	for _, compress := range []bool{true, false} {
		archive := makeTarGz(t, entries, compress)
		dest := filepath.Join(t.TempDir(), "public_html")
		if err := extractArchive(context.Background(), []string{archive}, dest, noLog); err != nil {
			t.Fatalf("compress=%v: %v", compress, err)
		}
		stripArtifacts(dest, "mvn-0123456789ab.php", noLog)
		for _, want := range []string{"wp-config.php", "index.php", "wp-content/uploads/a.txt", "wp-content/themes/x/y.css"} {
			if _, err := os.Stat(filepath.Join(dest, want)); err != nil {
				t.Fatalf("compress=%v: %s missing", compress, want)
			}
		}
		for _, gone := range []string{".mvn-tmp-deadbeef", "mvn-0123456789ab.php"} {
			if _, err := os.Stat(filepath.Join(dest, gone)); err == nil {
				t.Fatalf("compress=%v: %s should have been removed", compress, gone)
			}
		}
	}
}

func TestExtractArchiveFlattensWrapper(t *testing.T) {
	if _, err := exec.LookPath("tar"); err != nil {
		t.Skip("tar not installed")
	}
	archive := makeTarGz(t, map[string]string{"public_html/": "", "public_html/wp-config.php": "<?php", "public_html/wp-content/": "", "public_html/wp-content/x.txt": "x"}, true)
	dest := filepath.Join(t.TempDir(), "public_html")
	if err := extractArchive(context.Background(), []string{archive}, dest, noLog); err != nil {
		t.Fatal(err)
	}
	stripArtifacts(dest, "", noLog)
	if _, err := os.Stat(filepath.Join(dest, "wp-config.php")); err != nil {
		t.Fatal("wrapper directory was not flattened")
	}
	if _, err := os.Stat(filepath.Join(dest, "wp-content", "x.txt")); err != nil {
		t.Fatal("nested file lost while flattening")
	}
}

func TestExtractArchiveMultiPart(t *testing.T) {
	if _, err := exec.LookPath("tar"); err != nil {
		t.Skip("tar not installed")
	}
	archive := makeTarGz(t, map[string]string{"./index.php": strings.Repeat("x", 5000), "./a.txt": "a"}, true)
	data, _ := os.ReadFile(archive)
	dir := t.TempDir()
	p1, p2 := filepath.Join(dir, "part-000"), filepath.Join(dir, "part-001")
	os.WriteFile(p1, data[:len(data)/2], 0o644)
	os.WriteFile(p2, data[len(data)/2:], 0o644)
	dest := filepath.Join(dir, "out")
	if err := extractArchive(context.Background(), []string{p1, p2}, dest, noLog); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dest, "index.php"))
	if err != nil || len(b) != 5000 {
		t.Fatalf("split parts were not concatenated correctly: %v %d", err, len(b))
	}
}

func TestFindNonceAndPluginLinks(t *testing.T) {
	body := `<form method="post" id="search-plugins"></form>
<form method="post" enctype="multipart/form-data" class="wp-upload-form" action="https://x/wp-admin/update.php?action=upload-plugin" id="plugin-upload-form">
<input type="hidden" id="_wpnonce" name="_wpnonce" value="8f3a1c2b9d" /><input type="hidden" name="_wp_http_referer" value="/wp-admin/plugin-install.php?tab=upload" />
<input type="file" id="pluginzip" name="pluginzip" accept=".zip" /></form>`
	if got := findNonce(body, "plugin-upload-form"); got != "8f3a1c2b9d" {
		t.Fatalf("nonce %q", got)
	}
	if got := findNonce(`<input value="abc123" type="hidden" name="_wpnonce">`, ""); got != "abc123" {
		t.Fatalf("reversed attribute order nonce %q", got)
	}
	plugins := `<tr class="inactive" data-slug="mvn-migrator" data-plugin="mvn-migrator/mvn-migrator.php">
<a href="plugins.php?action=activate&amp;plugin=mvn-migrator%2Fmvn-migrator.php&amp;plugin_status=all&amp;paged=1&amp;s&amp;_wpnonce=0a1b2c3d4e" class="edit">Activate</a>
<a href="plugins.php?action=activate&amp;plugin=other%2Fother.php&amp;_wpnonce=ffff">Activate other</a>`
	link := findPluginLink(plugins, "activate")
	if link != "plugins.php?action=activate&plugin=mvn-migrator%2Fmvn-migrator.php&plugin_status=all&paged=1&s&_wpnonce=0a1b2c3d4e" {
		t.Fatalf("activate link %q", link)
	}
	if findPluginLink(plugins, "deactivate") != "" {
		t.Fatal("no deactivate link expected")
	}
	if !pluginListed(plugins) {
		t.Fatal("plugin row not detected")
	}
	w := &wpClient{siteURL: "https://x"}
	if got := w.resolveAdminLink(link); !strings.HasPrefix(got, "https://x/wp-admin/plugins.php?") {
		t.Fatalf("resolved %q", got)
	}
}

func TestConfigFromServerAndHost(t *testing.T) {
	srv := &storage.Server{Name: "s", PanelType: "ftp", Host: "ftp.example.com", Username: "u", Metadata: json.RawMessage(`{"site_url":"https://www.Example.com/","ftps":true,"docroot":"/public_html"}`)}
	cfg, err := ConfigFromServer(srv, "p")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 21 || !cfg.FTPS || cfg.Docroot != "/public_html" || cfg.SiteURL != "https://www.example.com" {
		t.Fatalf("cfg %+v", cfg)
	}
	if cfg.SiteHost() != "example.com" || Slug(cfg.SiteHost()) != "example_com" {
		t.Fatalf("host %q slug %q", cfg.SiteHost(), Slug(cfg.SiteHost()))
	}
	if got := cfg.siteURLCandidates(); !reflect.DeepEqual(got, []string{"https://www.example.com", "https://ftp.example.com", "http://ftp.example.com"}) {
		t.Fatalf("candidates %v", got)
	}

	srv2 := &storage.Server{Name: "s", PanelType: "ftp", Host: "ftp.example.co.il", Username: "u", Metadata: json.RawMessage(`{"ftps":"true"}`)}
	cfg2, _ := ConfigFromServer(srv2, "p")
	if !cfg2.FTPS || cfg2.SiteHost() != "example.co.il" {
		t.Fatalf("string ftps / ftp. prefix: %+v host %s", cfg2, cfg2.SiteHost())
	}

	srv3 := &storage.Server{Name: "s", PanelType: "wordpress", Host: "example.org", Username: "admin", Metadata: json.RawMessage(`{}`)}
	cfg3, _ := ConfigFromServer(srv3, "p")
	if cfg3.Port != 443 || cfg3.SiteURL != "https://example.org" || len(cfg3.siteURLCandidates()) != 1 {
		t.Fatalf("wordpress defaults %+v", cfg3)
	}
	if _, err := ConfigFromServer(&storage.Server{PanelType: "directadmin"}, "p"); err == nil {
		t.Fatal("directadmin must be rejected")
	}
	if _, err := ConfigFromServer(srv3, ""); err == nil {
		t.Fatal("empty password must be rejected")
	}
	if Slug("my-site.example.com") != "my_site_example_com" {
		t.Fatal(Slug("my-site.example.com"))
	}
}

func TestInfoParsingAndLastInfo(t *testing.T) {
	raw := json.RawMessage(`{"ok":true,"php_version":"7.4.33","exec":1,"wordpress":true,"wp_version":"6.4.2","db":{"name":"wp_db","user":"wp_user","host":"localhost"},"disk_free":1234567890.0,"max_execution_time":"30","memory_limit":"128M","files":{"count":"1200","bytes":734003200,"partial":false},"plugins":{"active":["a/a.php"],"litespeed_cache":1}}`)
	info, err := parseInfo(raw)
	if err != nil {
		t.Fatal(err)
	}
	if info.PHPMajorMinor() != "7.4" || !bool(info.Exec) || !bool(info.WordPress) || info.DB.Name != "wp_db" || info.DiskFree != 1234567890 || info.MaxExecutionTime != 30 || info.Files.Count != 1200 || !bool(info.Plugins.LiteSpeedCache) {
		t.Fatalf("parsed %+v", info)
	}
	if info.DiskUsed() != "700.0 MB" || info.Databases()[0] != "wp_db" {
		t.Fatalf("disk %q dbs %v", info.DiskUsed(), info.Databases())
	}
	if !strings.Contains(info.Summary(), "WordPress 6.4.2") || !strings.Contains(info.Summary(), "PHP 7.4.33") {
		t.Fatal(info.Summary())
	}

	srv := &storage.Server{PanelType: "ftp", Metadata: json.RawMessage(`{"site_url":"https://a.com","enhance_org_id":"x"}`)}
	if _, _, ok := LastInfo(srv); ok {
		t.Fatal("no last_info expected")
	}
	at := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	srv.Metadata = MetadataWithInfo(srv.Metadata, info, at)
	got, gotAt, ok := LastInfo(srv)
	if !ok || got.DB.Name != "wp_db" || !gotAt.Equal(at) {
		t.Fatalf("round trip failed: %v %v %v", ok, got, gotAt)
	}
	var meta map[string]interface{}
	json.Unmarshal(srv.Metadata, &meta)
	if meta["site_url"] != "https://a.com" || meta["enhance_org_id"] != "x" {
		t.Fatalf("other keys lost: %v", meta)
	}
	if MajorMinor("8") != "" || MajorMinor("8.2") != "8.2" || MajorMinor("PHP 8.1") != "" {
		t.Fatal("MajorMinor")
	}
}

func TestWPConfigCredentials(t *testing.T) {
	src := []byte("<?php\ndefine( 'DB_NAME', 'wp_site' );\ndefine('DB_USER', \"wp_u\");\ndefine( 'DB_PASSWORD', 'p@ss' );\ndefine('DB_HOST', 'localhost:3307');")
	got := wpConfigCredentials(src)
	if got["DB_NAME"] != "wp_site" || got["DB_USER"] != "wp_u" || got["DB_PASSWORD"] != "p@ss" || got["DB_HOST"] != "localhost:3307" {
		t.Fatalf("%v", got)
	}
	if h, p, err := splitHostPort("db.example.com:3307"); err != nil || h != "db.example.com" || p != "3307" {
		t.Fatal("splitHostPort")
	}
}

// fakeHelper simulates the PHP helper for an end-to-end export test.
type fakeHelper struct {
	t        *testing.T
	archive  []byte
	dump     []byte
	dumpName string
	calls    []string
	dumpN    int32
	archN    int32
}

func (f *fakeHelper) handler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	action := q.Get("action")
	if q.Get("token") != "tok" || r.Header.Get("X-MT-Token") != "tok" {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"ok":false,"error":"bad token"}`))
		return
	}
	f.calls = append(f.calls, action)
	w.Header().Set("Cache-Control", "no-store")
	switch action {
	case "dump":
		if atomic.AddInt32(&f.dumpN, 1) < 2 {
			fmt.Fprint(w, `{"ok":true,"done":false,"progress":{"tables_done":3,"tables_total":12,"rows":100}}`)
			return
		}
		fmt.Fprintf(w, `{"ok":true,"done":true,"file":%q,"size":%d,"tables":12}`, f.dumpName, len(f.dump))
	case "archive":
		if atomic.AddInt32(&f.archN, 1) < 2 {
			fmt.Fprint(w, `{"ok":true,"done":false,"progress":{"files":10,"bytes":1000}}`)
			return
		}
		fmt.Fprintf(w, `{"ok":true,"done":true,"parts":[{"file":"files.tar.gz","size":%d}]}`, len(f.archive))
	case "get":
		var data []byte
		switch q.Get("file") {
		case "files.tar.gz":
			data = f.archive
		case f.dumpName:
			data = f.dump
		default:
			fmt.Fprint(w, `{"ok":false,"error":"no such file"}`)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.Write(data)
	case "cleanup":
		fmt.Fprint(w, `{"ok":true}`)
	default:
		fmt.Fprint(w, `{"ok":false,"error":"unknown action"}`)
	}
}

func TestExportWithHelperEndToEnd(t *testing.T) {
	if _, err := exec.LookPath("tar"); err != nil {
		t.Skip("tar not installed")
	}
	archivePath := makeTarGz(t, map[string]string{"./wp-config.php": "<?php", "./index.php": "<?php", "./.mvn-tmp-abc/": "", "./.mvn-tmp-abc/x": "1", "./mvn-abcdefabcdef.php": "<?php"}, true)
	archive, _ := os.ReadFile(archivePath)
	fh := &fakeHelper{t: t, archive: archive, dump: []byte(strings.Repeat("INSERT INTO wp_posts VALUES (1);\n", 10)), dumpName: "db.sql"} // uncompressed: gzip missing on the source
	srv := httptest.NewServer(http.HandlerFunc(fh.handler))
	defer srv.Close()

	cfg := &Config{Mode: common.PanelTypeFTP, Host: "ftp.example.com", Port: 21, Username: "u", Password: "p", SiteURL: "https://example.com"}
	info, _ := parseInfo(json.RawMessage(`{"ok":true,"php_version":"8.1.27","exec":false,"wordpress":true,"db":{"name":"wp_db","user":"wp_u","host":"localhost"},"tmp_dir":"/home/u/public_html/.mvn-tmp-abc","files":{"count":5,"bytes":500,"partial":false}}`))
	h := newHelper(srv.URL+"/mvn-abcdefabcdef.php", false, "tok", noLog)
	sess := &session{cfg: cfg, helper: h, info: info, helperName: "mvn-abcdefabcdef.php"}

	workDir := t.TempDir()
	progress := make(chan common.MigrationProgress, 100)
	var logs []string
	ex := &exporter{cfg: cfg, host: cfg.SiteHost(), slug: Slug(cfg.SiteHost()), workDir: workDir, progress: progress, logFn: func(level, msg string) { logs = append(logs, level+": "+msg) }}
	saved := minLoopInterval
	minLoopInterval = 50 * time.Millisecond
	defer func() { minLoopInterval = saved }()
	data, err := ex.exportWithHelper(context.Background(), sess)
	if err != nil {
		t.Fatalf("export: %v\nlogs:\n%s", err, strings.Join(logs, "\n"))
	}
	if err := sess.close(context.Background()); err != nil {
		t.Fatal(err)
	}

	if data.Account.Username != "example_com" || data.Account.Domain != "example.com" || !data.Account.IsWordPress {
		t.Fatalf("account %+v", data.Account)
	}
	if len(data.Domains) != 1 || data.Domains[0].Name != "example.com" || data.Domains[0].DocumentRoot != "public_html" || data.Domains[0].PHPVersion != "8.1" {
		t.Fatalf("domains %+v", data.Domains)
	}
	if len(data.Databases) != 1 || data.Databases[0].Name != "wp_db" || data.Account.Databases[0] != "wp_db" {
		t.Fatalf("databases %+v", data.Databases)
	}
	if data.FilesPath != filepath.Join(workDir, "files") || data.SourcePanel != common.PanelTypeFTP {
		t.Fatalf("paths %+v", data)
	}
	dump := filepath.Join(workDir, "databases", "wp_db.sql.gz")
	if !isGzipFile(dump) {
		t.Fatal("dump was not gzipped locally")
	}
	gzr, _ := gzip.NewReader(mustOpen(t, dump))
	b, _ := io.ReadAll(gzr)
	if !bytes.Equal(b, fh.dump) {
		t.Fatal("dump content differs")
	}
	docroot := filepath.Join(workDir, "files", "domains", "example.com", "public_html")
	if _, err := os.Stat(filepath.Join(docroot, "wp-config.php")); err != nil {
		t.Fatal("files not extracted")
	}
	for _, gone := range []string{".mvn-tmp-abc", "mvn-abcdefabcdef.php"} {
		if _, err := os.Stat(filepath.Join(docroot, gone)); err == nil {
			t.Fatalf("%s should be stripped", gone)
		}
	}
	if _, err := os.Stat(filepath.Join(workDir, "download")); err == nil {
		t.Fatal("download directory should be removed")
	}
	if _, err := os.Stat(filepath.Join(workDir, "export_data.json")); err != nil {
		t.Fatal("export_data.json missing")
	}

	close(progress)
	var steps []string
	for p := range progress {
		if len(steps) == 0 || steps[len(steps)-1] != p.CurrentStep {
			steps = append(steps, p.CurrentStep)
		}
		if p.TotalSteps != totalSteps || p.Status != "running" {
			t.Fatalf("progress %+v", p)
		}
	}
	if !reflect.DeepEqual(steps, []string{StepDatabases, StepFiles, StepDone}) { // StepDomains is sent by Export before open()
		t.Fatalf("steps %v", steps)
	}
	wantCalls := []string{"dump", "dump", "get", "archive", "archive", "get", "cleanup"}
	if !reflect.DeepEqual(fh.calls, wantCalls) {
		t.Fatalf("helper calls %v, want %v", fh.calls, wantCalls)
	}
	warnings := 0
	for _, l := range logs {
		if strings.HasPrefix(l, "warn: ") && strings.Contains(l, "not available from an agentless source") {
			warnings++
		}
		if strings.Contains(l, "tok") && strings.Contains(l, "token=") {
			t.Fatalf("token leaked into logs: %s", l)
		}
	}
	if warnings != 3 {
		t.Fatalf("expected 3 'not available' warnings (emails, cron, DNS), got %d:\n%s", warnings, strings.Join(logs, "\n"))
	}
}

func mustOpen(t *testing.T, p string) *os.File {
	t.Helper()
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	return f
}

func TestExportUnreachableInWordPressModeIsAnError(t *testing.T) {
	// no fallback exists for wordpress sources: the error must be returned as is
	srv := &storage.Server{Name: "wp", PanelType: "wordpress", Host: "127.0.0.1", Port: 1, Username: "admin", Metadata: json.RawMessage(`{"site_url":"http://127.0.0.1:1"}`)}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_, err := Export(ctx, srv, "pw", t.TempDir(), nil, noLog)
	if err == nil || !strings.Contains(err.Error(), "wp-login.php") {
		t.Fatalf("expected a login reachability error, got %v", err)
	}
	var un *UnreachableError
	if errors.As(err, &un) {
		t.Fatal("wordpress mode must not report the helper as unreachable before the login")
	}
}

func TestHumanBytes(t *testing.T) {
	if HumanBytes(512) != "512 B" || HumanBytes(1536) != "1.5 KB" || HumanBytes(3<<30) != "3.0 GB" {
		t.Fatal(HumanBytes(512), HumanBytes(1536), HumanBytes(3<<30))
	}
}
