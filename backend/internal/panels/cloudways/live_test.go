//go:build live

package cloudways

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
)

// Runs against a real Cloudways server:
//
//	CLOUDWAYS_HOST=1.2.3.4 CLOUDWAYS_USER=master_xxx CLOUDWAYS_PASS=... go test -tags live -run TestLive -v ./internal/panels/cloudways/
//
// CLOUDWAYS_APP=<slug> additionally dumps that app's database into a temp dir.
func liveConnect(t *testing.T) (*Cloudways, context.Context) {
	host, user, pass := os.Getenv("CLOUDWAYS_HOST"), os.Getenv("CLOUDWAYS_USER"), os.Getenv("CLOUDWAYS_PASS")
	if host == "" || user == "" || pass == "" {
		t.Skip("CLOUDWAYS_HOST/USER/PASS not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	t.Cleanup(cancel)

	cw := New()
	cw.SetLogger(func(level, msg string) { t.Logf("[%s] %s", level, msg) })
	cfg := &common.ConnectionConfig{Host: host, Port: 22, Username: user, AuthMethod: common.AuthMethodPassword}
	if err := cw.Connect(ctx, cfg, pass, nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cw.Disconnect() })
	return cw, ctx
}

func TestLiveListAccounts(t *testing.T) {
	cw, ctx := liveConnect(t)
	accounts, err := cw.ListAccounts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(accounts) == 0 {
		t.Fatal("no applications found")
	}
	for _, a := range accounts {
		t.Logf("%s  domain=%s aliases=%v php=%s disk=%s db=%v dbsize=%s wp=%v meta=%v",
			a.Username, a.Domain, a.AddonDomains, a.PHPVersion, a.DiskUsage, a.Databases, a.DBSize, a.IsWordPress, a.Metadata)
	}
}

// CLOUDWAYS_DIR=<path under the app, e.g. public_html/wp-admin> downloads that subtree with the
// same transfer the exporter uses for public_html, to prove tar-over-SSH works for this user.
func TestLiveFastDownload(t *testing.T) {
	slug, sub := os.Getenv("CLOUDWAYS_APP"), os.Getenv("CLOUDWAYS_DIR")
	if slug == "" || sub == "" {
		t.Skip("CLOUDWAYS_APP/CLOUDWAYS_DIR not set")
	}
	cw, ctx := liveConnect(t)
	dir := t.TempDir()
	remote := cw.appDir(slug) + "/" + sub
	total, err := cw.sshClient.RemoteDirSize(ctx, remote)
	if err != nil {
		t.Fatal(err)
	}
	progress := make(chan int64, 64)
	var counted int64
	done := make(chan struct{})
	go func() {
		defer close(done)
		for n := range progress {
			counted += n
		}
	}()
	start := time.Now()
	if err := cw.sshClient.RsyncDownloadWithKey(ctx, remote, dir, progress); err != nil {
		t.Fatal(err)
	}
	close(progress)
	<-done
	n, size := 0, int64(0)
	filepath.Walk(dir, func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			n++
			size += info.Size()
		}
		return nil
	})
	t.Logf("downloaded %d files, %d bytes on disk in %s; du on source %d; progress counted %d (%.1f%% of du)", n, size, time.Since(start).Round(time.Millisecond), total, counted, float64(counted)*100/float64(total))
	if n == 0 {
		t.Fatal("nothing downloaded")
	}
	if counted < size || counted > size*11/10+1024*1024 {
		t.Fatalf("progress count %d is not close to the %d bytes that arrived", counted, size)
	}

	// Upload the same tree back into the master user's home with the tar+gzip path the Enhance
	// importer uses, then remove it.
	remoteUp := fmt.Sprintf("$HOME/.migration-upload-test-%d", time.Now().UnixNano())
	remoteUp, _ = cw.sshClient.RunCommand(ctx, "printf %s "+remoteUp)
	progressUp := make(chan int64, 64)
	var countedUp int64
	doneUp := make(chan struct{})
	go func() {
		defer close(doneUp)
		for n := range progressUp {
			countedUp += n
		}
	}()
	start = time.Now()
	err = cw.sshClient.RsyncUploadWithKey(ctx, dir, remoteUp, progressUp)
	close(progressUp)
	<-doneUp
	out, _ := cw.sshClient.RunCommand(ctx, fmt.Sprintf("find %s -type f | wc -l; du -sb %s | cut -f1; rm -rf %s", shq(remoteUp), shq(remoteUp), shq(remoteUp)))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("uploaded in %s; progress counted %d; on the server (files, bytes): %s", time.Since(start).Round(time.Millisecond), countedUp, strings.Join(strings.Fields(out), " "))
	if f := strings.Fields(out); len(f) < 1 || f[0] != fmt.Sprint(n) {
		t.Fatalf("expected %d files on the server, got %q", n, out)
	}
}

func TestLiveExportDatabases(t *testing.T) {
	slug := os.Getenv("CLOUDWAYS_APP")
	if slug == "" {
		t.Skip("CLOUDWAYS_APP not set")
	}
	cw, ctx := liveConnect(t)
	dir := t.TempDir()
	dbs, err := cw.ExportDatabases(ctx, slug, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(dbs) != 1 {
		t.Fatalf("want 1 database, got %d", len(dbs))
	}
	st, err := os.Stat(filepath.Join(dir, "databases", dbs[0].Name+".sql.gz"))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("dump %s: %d bytes, users %v", dbs[0].Name, st.Size(), dbs[0].Users)
	if err := cw.CleanupTempFiles(ctx); err != nil {
		t.Fatal(err)
	}
}
