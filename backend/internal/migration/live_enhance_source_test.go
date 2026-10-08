//go:build live

package migration

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/storage"
	"github.com/migration-tool/backend/pkg/config"
	"github.com/migration-tool/backend/pkg/logger"
)

// Runs inside the app container (needs its DB env): lists the websites of an Enhance console
// registered in the tool and exports the smallest one into a temp dir.
//
//	ENHANCE_SOURCE="console.mvn.co.il" [ENHANCE_SOURCE_USER=<unix user>] ./migration.test -test.run TestLiveEnhanceSource -test.v
func TestLiveEnhanceSource(t *testing.T) {
	name := os.Getenv("ENHANCE_SOURCE")
	if name == "" {
		t.Skip("ENHANCE_SOURCE not set")
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	db, err := storage.NewDatabase(&storage.Config{Host: cfg.DBHost, Port: cfg.DBPort, User: cfg.DBUser, Password: cfg.DBPassword, Database: cfg.DBName, SSLMode: cfg.DBSSLMode, MasterKey: cfg.MasterKey})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	server, err := db.GetServerByName(ctx, name)
	if err != nil {
		t.Fatal(err)
	}
	e := NewEngine(db, logger.New(&logger.Config{Level: "info"}), t.TempDir())

	accounts, err := e.GetServerAccounts(ctx, server, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%d website(s) on %s", len(accounts), name)
	pick := os.Getenv("ENHANCE_SOURCE_USER")
	var smallest *AccountInfo
	for i := range accounts {
		a := &accounts[i]
		t.Logf("  %s  user=%s php=%s disk=%s aliases=%v suspended=%v", a.Domain, a.Username, a.PHPVersion, a.DiskUsed, a.AddonDomains, a.Suspended)
		if pick == "" && !a.Suspended && (smallest == nil || sizeOf(a.DiskUsed) < sizeOf(smallest.DiskUsed)) && sizeOf(a.DiskUsed) > 0 {
			smallest = a
		}
	}
	if pick == "" && smallest != nil {
		pick = smallest.Username
	}
	if pick == "" {
		t.Skip("no website to export")
	}

	workDir := filepath.Join(e.workDir, "live-export")
	progress := make(chan common.MigrationProgress, 100)
	go func() {
		for p := range progress {
			if p.CurrentStep != "" && !p.Logged {
				t.Logf("[step] %s", p.CurrentStep)
			}
		}
	}()
	logFn := func(level, msg string) { t.Logf("[%s] %s", level, msg) }
	start := time.Now()
	data, err := e.exportFromSource(ctx, server, pick, workDir, progress, logFn)
	close(progress)
	if err != nil {
		t.Fatal(err)
	}
	files := 0
	filepath.Walk(data.FilesPath, func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			files++
		}
		return nil
	})
	t.Logf("exported %s in %s: domains=%v dbs=%d emails=%d cron=%d files=%d", data.Account.Domain, time.Since(start).Round(time.Second), domainNames(data.Domains), len(data.Databases), len(data.Emails), len(data.CronJobs), files)
	for _, db := range data.Databases {
		st, _ := os.Stat(filepath.Join(workDir, "databases", db.Name+".sql.gz"))
		t.Logf("  db %s: %d bytes compressed, users %v", db.Name, st.Size(), db.Users)
	}
	if files == 0 {
		t.Fatal("no files exported")
	}
}

func domainNames(ds []common.Domain) []string {
	var out []string
	for _, d := range ds {
		out = append(out, fmt.Sprintf("%s (docroot %s, aliases %v)", d.Name, d.DocumentRoot, d.Aliases))
	}
	return out
}

func sizeOf(s string) int64 {
	var n float64
	var unit string
	fmt.Sscanf(s, "%f %s", &n, &unit)
	unit = strings.ReplaceAll(unit, "i", "")
	mult := map[string]float64{"B": 1, "KB": 1 << 10, "MB": 1 << 20, "GB": 1 << 30, "TB": 1 << 40}[unit]
	return int64(n * mult)
}
