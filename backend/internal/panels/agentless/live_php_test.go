package agentless

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
)

// TestLivePHPHelper runs the embedded helper under PHP's built-in web server and drives the
// real info/archive/get/cleanup protocol (dump needs MySQL and is skipped: a non-WordPress
// docroot has no database). Opt in with MVN_LIVE_PHP=1; it also needs php and a finished
// mvn-agent.php (the asset is maintained separately).
func TestLivePHPHelper(t *testing.T) {
	if os.Getenv("MVN_LIVE_PHP") == "" {
		t.Skip("set MVN_LIVE_PHP=1 to run the helper under php -S")
	}
	phpBin, err := exec.LookPath("php")
	if err != nil {
		t.Skip("php not installed")
	}
	if src, err := assets.ReadFile(agentAssetPath); err != nil || len(src) < 1000 {
		t.Skip("mvn-agent.php is still a placeholder")
	}
	if _, err := exec.LookPath("tar"); err != nil {
		t.Skip("tar not installed")
	}

	docroot := t.TempDir()
	files := map[string]string{
		"index.php":               "<?php echo 'hi';",
		"style.css":               "body{}",
		"sub/dir/deep.txt":        strings.Repeat("deep\n", 100),
		"wp-content/cache/x.html": "cached",
		"error_log":               "should be excluded",
	}
	for name, content := range files {
		p := filepath.Join(docroot, name)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(content), 0o644)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	php := exec.Command(phpBin, "-S", addr, "-t", docroot)
	php.Dir = docroot
	var phpOut strings.Builder
	php.Stdout, php.Stderr = &phpOut, &phpOut
	if err := php.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		php.Process.Kill()
		php.Wait()
		if testing.Verbose() {
			t.Logf("php -S output:\n%s", phpOut.String())
		}
	}()
	base := "http://" + addr
	ready := false
	for i := 0; i < 50 && !ready; i++ {
		if resp, err := http.Get(base + "/index.php"); err == nil {
			resp.Body.Close()
			ready = true
		} else {
			time.Sleep(100 * time.Millisecond)
		}
	}
	if !ready {
		t.Fatalf("php -S did not come up: %s", phpOut.String())
	}

	var logs []string
	logFn := func(level, msg string) { logs = append(logs, level+": "+msg) }
	hc := helperConfig{Token: randHex(32), Expires: time.Now().Add(time.Hour)}
	rendered, err := renderAgent(hc)
	if err != nil {
		t.Fatal(err)
	}
	helperName := "mig-" + randHex(12) + ".php"
	if err := os.WriteFile(filepath.Join(docroot, helperName), rendered, 0o644); err != nil {
		t.Fatal(err)
	}

	h := newHelper(base+"/"+helperName, false, hc.Token, logFn)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	raw, err := h.call(ctx, "info", nil)
	if err != nil {
		t.Fatalf("info: %v\n%s", err, strings.Join(logs, "\n"))
	}
	info, err := parseInfo(raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("info: %s", info.Summary())
	if bool(info.WordPress) || info.DB.Name != "" || info.PHPMajorMinor() == "" || info.Files.Count < 3 {
		t.Fatalf("unexpected info: %s", string(raw))
	}

	saved := minLoopInterval
	minLoopInterval = 100 * time.Millisecond
	defer func() { minLoopInterval = saved }()

	cfg := &Config{Mode: common.PanelTypeFTP, Host: "127.0.0.1", Port: 21, Username: "u", Password: "p", SiteURL: base}
	sess := &session{cfg: cfg, helper: h, info: info, helperName: helperName}
	workDir := t.TempDir()
	ex := &exporter{cfg: cfg, host: cfg.SiteHost(), slug: Slug(cfg.SiteHost()), workDir: workDir, logFn: logFn}
	data, err := ex.exportWithHelper(ctx, sess)
	if err != nil {
		t.Fatalf("export: %v\n%s", err, strings.Join(logs, "\n"))
	}
	if err := sess.close(ctx); err != nil {
		t.Fatalf("cleanup: %v\n%s", err, strings.Join(logs, "\n"))
	}

	if len(data.Databases) != 0 || data.Account.Username != "127_0_0_1" {
		t.Fatalf("export data %+v", data)
	}
	out := filepath.Join(workDir, "files", "domains", "127.0.0.1", "public_html")
	for _, want := range []string{"index.php", "style.css", "sub/dir/deep.txt"} {
		b, err := os.ReadFile(filepath.Join(out, want))
		if err != nil || string(b) != files[want] {
			t.Fatalf("%s not extracted correctly: %v", want, err)
		}
	}
	for _, excluded := range []string{"wp-content/cache/x.html", "error_log", helperName} {
		if _, err := os.Stat(filepath.Join(out, excluded)); err == nil {
			t.Errorf("%s should not be in the export", excluded)
		}
	}
	if entries, _ := os.ReadDir(out); len(entries) > 0 {
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), ".mig-tmp-") {
				t.Errorf("temp dir %s leaked into the export", e.Name())
			}
		}
	}
	// cleanup removed the helper and its temp dir from the docroot
	if _, err := os.Stat(filepath.Join(docroot, helperName)); err == nil {
		t.Error("helper file still in the docroot after cleanup")
	}
	entries, _ := os.ReadDir(docroot)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".mig-tmp-") {
			t.Errorf("temp dir %s still in the docroot after cleanup", e.Name())
		}
	}
	for _, l := range logs {
		if strings.Contains(l, hc.Token) {
			t.Fatalf("token leaked into logs: %s", l)
		}
	}
	if testing.Verbose() {
		t.Log(strings.Join(logs, "\n"))
	}
}
