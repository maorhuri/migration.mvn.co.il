package security

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
)

var injectedDirectiveRe = regexp.MustCompile(`(?i)auto_prepend_file|auto_append_file`)

// Clean applies the automatic actions of the cleanable findings on the staging copy: files and
// directories are moved to <workdir>/quarantine (never deleted), modified core files are replaced
// with the pristine release copy, injected directives are stripped from config files. Database
// findings are report-only. The report is updated in place.
func Clean(ctx context.Context, data *common.ExportData, report *Report, opts Options) *CleanupResult {
	res := &CleanupResult{At: time.Now(), QuarantineDir: filepath.Join(filepath.Dir(data.FilesPath), "quarantine")}
	docroots := map[string]string{}
	for _, d := range data.Domains {
		docroots[d.Name] = filepath.Join(data.FilesPath, "domains", d.Name, "public_html")
	}
	versions := map[string]string{}
	for _, ds := range report.Domains {
		versions[ds.Domain] = ds.CoreVersion
	}
	done := map[string]bool{}

	for i := range report.Findings {
		f := &report.Findings[i]
		if !f.Cleanable || f.Cleaned {
			continue
		}
		if err := ctx.Err(); err != nil {
			res.Errors = append(res.Errors, "cancelled")
			break
		}
		docroot, ok := docroots[f.Domain]
		if !ok || strings.HasPrefix(f.Path, "db:") {
			res.Skipped = append(res.Skipped, f.Path)
			continue
		}
		key := f.Domain + "|" + f.Path
		abs := filepath.Join(docroot, filepath.FromSlash(f.Path))
		if !strings.HasPrefix(abs, docroot) {
			res.Skipped = append(res.Skipped, f.Path)
			continue
		}
		if done[key] {
			f.Cleaned = true
			continue
		}
		qdst := filepath.Join(res.QuarantineDir, f.Domain, filepath.FromSlash(f.Path))

		switch f.Action {
		case ActionQuarantine:
			if _, err := os.Stat(abs); err != nil {
				f.Cleaned = true // already gone (a parent directory was quarantined)
				done[key] = true
				continue
			}
			if err := moveToQuarantine(abs, qdst); err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", f.Path, err))
				continue
			}
			res.Quarantined = append(res.Quarantined, f.Domain+"/"+f.Path)
			opts.logf("info", "Quarantined %s (%s: %s)", f.Path, f.Category, f.Evidence)

		case ActionRestoreCore:
			ver := versions[f.Domain]
			if ver == "" {
				res.Skipped = append(res.Skipped, f.Path)
				continue
			}
			pristine, err := pristineCoreFile(ctx, opts.CacheDir, ver, f.Path)
			if err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", f.Path, err))
				continue
			}
			if err := copyFile(abs, qdst); err != nil { // keep the tampered copy as evidence
				res.Errors = append(res.Errors, fmt.Sprintf("%s: keep evidence: %v", f.Path, err))
				continue
			}
			if err := os.WriteFile(abs, pristine, 0644); err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", f.Path, err))
				continue
			}
			res.Restored = append(res.Restored, f.Domain+"/"+f.Path)
			opts.logf("info", "Restored %s from WordPress %s (tampered copy kept in quarantine)", f.Path, ver)

		case ActionRemoveLines:
			content, err := os.ReadFile(abs)
			if err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", f.Path, err))
				continue
			}
			if err := copyFile(abs, qdst); err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("%s: keep evidence: %v", f.Path, err))
				continue
			}
			var kept []string
			removed := 0
			for _, line := range strings.Split(string(content), "\n") {
				if injectedDirectiveRe.MatchString(line) {
					removed++
					continue
				}
				kept = append(kept, line)
			}
			if err := os.WriteFile(abs, []byte(strings.Join(kept, "\n")), 0644); err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", f.Path, err))
				continue
			}
			res.LinesRemoved = append(res.LinesRemoved, fmt.Sprintf("%s/%s (%d line(s))", f.Domain, f.Path, removed))
			opts.logf("info", "Removed %d injected directive line(s) from %s", removed, f.Path)

		default:
			res.Skipped = append(res.Skipped, f.Path)
			continue
		}
		f.Cleaned = true
		done[key] = true
	}
	report.Cleanup = res
	return res
}

func moveToQuarantine(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	if _, err := os.Stat(dst); err == nil {
		dst = dst + "." + time.Now().Format("150405")
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	// cross-device fallback for files
	st, err := os.Stat(src)
	if err != nil {
		return err
	}
	if st.IsDir() {
		return fmt.Errorf("cannot move directory across filesystems")
	}
	if err := copyFile(src, dst); err != nil {
		return err
	}
	return os.Remove(src)
}
