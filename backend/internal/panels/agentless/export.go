package agentless

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/storage"
)

// Progress step names (the UI maps them).
const (
	StepDomains   = "Exporting domains"
	StepDatabases = "Exporting databases"
	StepFiles     = "Downloading files"
	StepDone      = "Export completed"
	totalSteps    = 4
)

// minLoopInterval keeps consecutive dump/archive calls apart when a chunk returns early
// (a variable so tests can shorten it); maxLoopCalls bounds a loop at ~11 h of 20 s chunks.
var minLoopInterval = 5 * time.Second

const maxLoopCalls = 2000

// Export runs the whole agentless export into workDir and returns the ExportData the Enhance
// importer consumes: files under <workDir>/files/domains/<host>/public_html and the database
// dump at <workDir>/databases/<db>.sql.gz.
func Export(ctx context.Context, server *storage.Server, password, workDir string, progress chan<- common.MigrationProgress, logFn LogFunc) (*common.ExportData, error) {
	if logFn == nil {
		logFn = func(string, string) {}
	}
	cfg, err := ConfigFromServer(server, password)
	if err != nil {
		return nil, err
	}
	host := cfg.SiteHost()
	slug := Slug(host)
	ex := &exporter{cfg: cfg, host: host, slug: slug, workDir: workDir, progress: progress, logFn: logFn}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create work directory: %w", err)
	}

	ex.step(StepDomains, 0, false)
	logFn("info", fmt.Sprintf("Agentless export (%s) of %s as account %s", cfg.Mode, host, slug))
	sess, err := open(ctx, cfg, logFn)
	if err != nil {
		var un *UnreachableError
		if cfg.Mode == common.PanelTypeFTP && errors.As(err, &un) {
			return ex.exportFallback(ctx, un)
		}
		return nil, err
	}
	defer func() {
		if cerr := sess.close(ctx); cerr != nil {
			logFn("warn", "Helper cleanup: "+cerr.Error())
		}
	}()
	return ex.exportWithHelper(ctx, sess)
}

type exporter struct {
	cfg      *Config
	host     string
	slug     string
	workDir  string
	progress chan<- common.MigrationProgress
	logFn    LogFunc
	lastStep string
}

// step reports a progress step; the first report of a step is logged by the engine, later
// updates of the same step (with counters) are marked as already logged.
func (ex *exporter) step(name string, completed int, logged bool) {
	ex.send(common.MigrationProgress{CurrentStep: name, CompletedSteps: completed, Logged: logged})
}

func (ex *exporter) send(p common.MigrationProgress) {
	if ex.progress == nil {
		return
	}
	p.Status = "running"
	p.TotalSteps = totalSteps
	if p.CurrentStep == ex.lastStep {
		p.Logged = true
	}
	ex.lastStep = p.CurrentStep
	select {
	case ex.progress <- p:
	case <-time.After(5 * time.Second):
	}
}

func (ex *exporter) newExportData(info *Info) *common.ExportData {
	data := &common.ExportData{
		ExportedAt:  time.Now(),
		SourcePanel: ex.cfg.Mode,
		Account: common.Account{
			Username:      ex.slug,
			Domain:        ex.host,
			EmailAccounts: []string{},
			Metadata:      map[string]string{"source_host": ex.cfg.Host, "site_url": ex.cfg.SiteURL},
		},
		Domains: []common.Domain{{
			Name:         ex.host,
			Type:         "main",
			DocumentRoot: "public_html",
		}},
		Emails:     []common.EmailAccount{},
		CronJobs:   []common.CronJob{},
		DNSRecords: []common.DNSRecord{},
		FilesPath:  filepath.Join(ex.workDir, "files"),
	}
	if info != nil {
		php := info.PHPMajorMinor()
		data.Domains[0].PHPVersion = php
		data.Account.PHPVersion = php
		data.Account.IsWordPress = bool(info.WordPress)
		if data.Account.IsWordPress {
			data.Account.SiteType = "wordpress"
		}
		data.Account.DiskUsage = info.DiskUsed()
	}
	return data
}

func (ex *exporter) warnMissing() {
	ex.logFn("warn", "Email accounts are not available from an agentless source; none were exported")
	ex.logFn("warn", "Cron jobs are not available from an agentless source; none were exported")
	ex.logFn("warn", "DNS records are not available from an agentless source; none were exported")
}

func (ex *exporter) finish(data *common.ExportData) (*common.ExportData, error) {
	ex.warnMissing()
	if f, err := os.Create(filepath.Join(ex.workDir, "export_data.json")); err == nil {
		enc := json.NewEncoder(f)
		enc.SetIndent("", "  ")
		enc.Encode(data)
		f.Close()
	}
	ex.send(common.MigrationProgress{CurrentStep: StepDone, CompletedSteps: totalSteps, Logged: true})
	return data, nil
}

// exportWithHelper is the normal path: dump and archive on the source, download, extract.
func (ex *exporter) exportWithHelper(ctx context.Context, sess *session) (*common.ExportData, error) {
	info := sess.info
	h := sess.helper
	data := ex.newExportData(info)
	if !bool(info.WordPress) {
		ex.logFn("warn", "No wp-config.php in the docroot: the site is exported as plain files")
	}
	if bool(info.Files.Partial) {
		ex.logFn("info", fmt.Sprintf("File count is a lower bound (%d files, %s); the walk was cut at the helper's time budget", int64(info.Files.Count), HumanBytes(int64(info.Files.Bytes))))
	}

	// 2. database
	ex.step(StepDatabases, 1, false)
	dbName, dumpParams := ex.dumpTarget(info)
	if dbName == "" {
		ex.logFn("info", "No database to export (not a WordPress site and no db_* metadata)")
	} else {
		db, err := ex.dumpDatabase(ctx, h, dbName, dumpParams)
		if err != nil {
			return nil, fmt.Errorf("database export failed: %w", err)
		}
		data.Databases = []common.Database{*db}
		data.Account.Databases = []string{dbName}
		data.Account.DBCount = 1
		data.Account.DBSize = HumanBytes(db.Size)
	}

	// 3. files
	ex.step(StepFiles, 2, false)
	parts, err := ex.archive(ctx, h)
	if err != nil {
		return nil, fmt.Errorf("archive on the source failed: %w", err)
	}
	downloadDir := filepath.Join(ex.workDir, "download")
	if err := os.MkdirAll(downloadDir, 0o755); err != nil {
		return nil, err
	}
	var total int64
	for _, p := range parts {
		total += p.Size
	}
	var localParts []string
	var doneBefore int64
	lastLog := time.Now()
	for i, p := range parts {
		local := filepath.Join(downloadDir, localPartName(i, p.File))
		ex.logFn("info", fmt.Sprintf("Downloading part %d/%d %s (%s)", i+1, len(parts), p.File, HumanBytes(p.Size)))
		base := doneBefore
		err := h.download(ctx, p.File, local, p.Size, func(done int64) {
			if time.Since(lastLog) >= 2*time.Second {
				lastLog = time.Now()
				ex.send(common.MigrationProgress{CurrentStep: StepFiles, CompletedSteps: 2, BytesTransferred: base + done, TotalBytes: total, Logged: true})
			}
		})
		if err != nil {
			return nil, err
		}
		doneBefore += p.Size
		localParts = append(localParts, local)
	}
	ex.send(common.MigrationProgress{CurrentStep: StepFiles, CompletedSteps: 2, BytesTransferred: total, TotalBytes: total, Logged: true})
	ex.logFn("info", fmt.Sprintf("Downloaded %s in %d part(s); extracting", HumanBytes(total), len(parts)))

	dest := filepath.Join(ex.workDir, "files", "domains", ex.host, "public_html")
	if err := extractArchive(ctx, localParts, dest, ex.logFn); err != nil {
		return nil, fmt.Errorf("extracting the archive failed: %w", err)
	}
	os.RemoveAll(downloadDir)
	stripArtifacts(dest, sess.helperName, ex.logFn)
	if n, b, err := dirStats(dest); err == nil {
		ex.logFn("info", fmt.Sprintf("Files extracted to %s: %d files, %s", dest, n, HumanBytes(b)))
	}
	return ex.finish(data)
}

// dumpTarget decides which database to dump: the one from wp-config.php, unless direct MySQL
// credentials are configured (they override, e.g. for a non-WordPress site).
func (ex *exporter) dumpTarget(info *Info) (string, map[string]string) {
	cfg := ex.cfg
	if cfg.DBHost != "" && cfg.DBUser != "" && cfg.DBName != "" {
		return cfg.DBName, map[string]string{"db_host": cfg.DBHost, "db_user": cfg.DBUser, "db_pass": cfg.DBPass, "db_name": cfg.DBName}
	}
	if info != nil && info.DB.Name != "" {
		return info.DB.Name, nil
	}
	return "", nil
}

type dumpState struct {
	Done     bool   `json:"done"`
	File     string `json:"file"`
	Size     int64  `json:"size"`
	Tables   int    `json:"tables"`
	Progress struct {
		TablesDone  int   `json:"tables_done"`
		TablesTotal int   `json:"tables_total"`
		Rows        int64 `json:"rows"`
	} `json:"progress"`
}

// dumpDatabase drives the chunked dump, downloads it and stores it gzip-compressed.
func (ex *exporter) dumpDatabase(ctx context.Context, h *helper, dbName string, params map[string]string) (*common.Database, error) {
	var st dumpState
	if params != nil && params["db_pass"] != "" {
		h.secrets = append(h.secrets, params["db_pass"])
	}
	lastLog := time.Now()
	for i := 0; ; i++ {
		if i >= maxLoopCalls {
			return nil, fmt.Errorf("the dump did not finish after %d calls", i)
		}
		start := time.Now()
		raw, err := h.call(ctx, "dump", params)
		if errors.Is(err, errBusy) {
			if err := pace(ctx, start); err != nil {
				return nil, err
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		st = dumpState{}
		if err := json.Unmarshal(raw, &st); err != nil {
			return nil, fmt.Errorf("dump answer could not be decoded: %w", err)
		}
		if st.Done {
			break
		}
		ex.send(common.MigrationProgress{CurrentStep: StepDatabases, CompletedSteps: 1, BytesTransferred: int64(st.Progress.TablesDone), TotalBytes: int64(st.Progress.TablesTotal), Logged: true})
		if time.Since(lastLog) >= 30*time.Second {
			lastLog = time.Now()
			ex.logFn("info", fmt.Sprintf("Database dump in progress: %d/%d tables, %d rows", st.Progress.TablesDone, st.Progress.TablesTotal, st.Progress.Rows))
		}
		if err := pace(ctx, start); err != nil {
			return nil, err
		}
	}
	if st.File == "" {
		return nil, fmt.Errorf("the helper reported a finished dump without a file name")
	}
	ex.logFn("info", fmt.Sprintf("Database %s dumped on the source: %s, %d tables (%s)", dbName, st.File, st.Tables, HumanBytes(st.Size)))

	downloadDir := filepath.Join(ex.workDir, "download")
	if err := os.MkdirAll(downloadDir, 0o755); err != nil {
		return nil, err
	}
	local := filepath.Join(downloadDir, filepath.Base(st.File))
	if err := h.download(ctx, st.File, local, st.Size, nil); err != nil {
		return nil, err
	}
	dbDir := filepath.Join(ex.workDir, "databases")
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		return nil, err
	}
	final := filepath.Join(dbDir, dbName+".sql.gz")
	if err := storeGzipped(local, final); err != nil {
		return nil, err
	}
	os.Remove(local)
	fi, err := os.Stat(final)
	if err != nil || fi.Size() < 64 {
		return nil, fmt.Errorf("dump of %s is empty", dbName)
	}
	db := &common.Database{Name: dbName, Type: "mysql", Size: fi.Size(), Charset: "utf8mb4"}
	if params == nil {
		if u := ex.cfg.DBUser; u != "" {
			db.Users = []common.DBUser{{Username: u, Host: "localhost"}}
		}
	} else if params["db_user"] != "" {
		db.Users = []common.DBUser{{Username: params["db_user"], Host: "localhost"}}
	}
	return db, nil
}

type archivePart struct {
	File string `json:"file"`
	Size int64  `json:"size"`
}

type archiveState struct {
	Done     bool          `json:"done"`
	Parts    []archivePart `json:"parts"`
	Progress struct {
		Files int64 `json:"files"`
		Bytes int64 `json:"bytes"`
	} `json:"progress"`
}

// archive drives the chunked archive creation on the source.
func (ex *exporter) archive(ctx context.Context, h *helper) ([]archivePart, error) {
	lastLog := time.Now()
	for i := 0; ; i++ {
		if i >= maxLoopCalls {
			return nil, fmt.Errorf("the archive did not finish after %d calls", i)
		}
		start := time.Now()
		raw, err := h.call(ctx, "archive", nil)
		if errors.Is(err, errBusy) {
			if err := pace(ctx, start); err != nil {
				return nil, err
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		var st archiveState
		if err := json.Unmarshal(raw, &st); err != nil {
			return nil, fmt.Errorf("archive answer could not be decoded: %w", err)
		}
		if st.Done {
			if len(st.Parts) == 0 {
				return nil, fmt.Errorf("the helper reported a finished archive without parts")
			}
			for _, p := range st.Parts {
				if p.File == "" || strings.ContainsAny(p.File, "/\\") {
					return nil, fmt.Errorf("invalid part name %q", p.File)
				}
			}
			return st.Parts, nil
		}
		ex.send(common.MigrationProgress{CurrentStep: StepFiles, CompletedSteps: 2, BytesTransferred: st.Progress.Bytes, Logged: true})
		if time.Since(lastLog) >= 30*time.Second {
			lastLog = time.Now()
			ex.logFn("info", fmt.Sprintf("Archive in progress on the source: %d files, %s", st.Progress.Files, HumanBytes(st.Progress.Bytes)))
		}
		if err := pace(ctx, start); err != nil {
			return nil, err
		}
	}
}

// pace waits so that consecutive helper calls are at least minLoopInterval apart.
func pace(ctx context.Context, start time.Time) error {
	if wait := minLoopInterval - time.Since(start); wait > 0 {
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return ctx.Err()
}

// localPartName keeps the parts sortable and unique on disk.
func localPartName(index int, remote string) string {
	return fmt.Sprintf("part-%03d-%s", index, filepath.Base(remote))
}

var gzipMagic = []byte{0x1f, 0x8b}

func isGzipFile(p string) bool {
	f, err := os.Open(p)
	if err != nil {
		return false
	}
	defer f.Close()
	head := make([]byte, 2)
	n, _ := io.ReadFull(f, head)
	return n == 2 && bytes.Equal(head, gzipMagic)
}

// storeGzipped moves a dump to its final .sql.gz path, compressing it when it arrived raw.
func storeGzipped(src, dest string) error {
	if isGzipFile(src) {
		if err := os.Rename(src, dest); err != nil {
			return copyFile(src, dest)
		}
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	gz, _ := gzip.NewWriterLevel(out, gzip.BestSpeed)
	if _, err := io.Copy(gz, in); err != nil {
		out.Close()
		return err
	}
	if err := gz.Close(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func copyFile(src, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// extractArchive unpacks the downloaded part(s) (one tar stream, gzip-compressed or not) into dest.
func extractArchive(ctx context.Context, parts []string, dest string, logFn LogFunc) error {
	if len(parts) == 0 {
		return fmt.Errorf("no archive parts")
	}
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	tarBin, err := exec.LookPath("tar")
	if err != nil {
		return fmt.Errorf("tar is not installed on the migration server: %w", err)
	}
	args := []string{"-x", "--no-same-owner", "-C", dest, "-f", "-"}
	if isGzipFile(parts[0]) {
		args = append([]string{"-z"}, args...)
	} else {
		logFn("info", "Archive is not gzip-compressed (gzip was unavailable on the source); extracting as plain tar")
	}
	readers := make([]io.Reader, 0, len(parts))
	files := make([]*os.File, 0, len(parts))
	defer func() {
		for _, f := range files {
			f.Close()
		}
	}()
	for _, p := range parts {
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		files = append(files, f)
		readers = append(readers, f)
	}
	cmd := exec.CommandContext(ctx, tarBin, args...)
	cmd.Stdin = io.MultiReader(readers...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		// GNU tar exits 1 for "file changed"/unknown keyword warnings while extracting everything
		if ee, ok := err.(*exec.ExitError); ok && ee.ExitCode() == 1 && !strings.Contains(msg, "Unexpected EOF") && !strings.Contains(msg, "not recoverable") {
			logFn("warn", "tar finished with warnings: "+snippet(msg, 500))
			return nil
		}
		return fmt.Errorf("tar failed: %v: %s", err, snippet(msg, 500))
	}
	if msg := strings.TrimSpace(stderr.String()); msg != "" {
		logFn("info", "tar: "+snippet(msg, 300))
	}
	return nil
}

// stripArtifacts removes helper leftovers from the extracted tree (temp dir, helper file) and
// flattens a single wrapping directory (an archive built from the parent of the docroot).
func stripArtifacts(dest, helperName string, logFn LogFunc) {
	entries, err := os.ReadDir(dest)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() && strings.HasPrefix(name, ".mig-tmp-") {
			os.RemoveAll(filepath.Join(dest, name))
			logFn("info", "Removed helper temp directory "+name+" from the extracted files")
		}
		if !e.IsDir() && helperName != "" && name == helperName {
			os.Remove(filepath.Join(dest, name))
			logFn("info", "Removed the helper file "+name+" from the extracted files")
		}
	}
	entries, err = os.ReadDir(dest)
	if err != nil || len(entries) != 1 || !entries[0].IsDir() {
		return
	}
	inner := filepath.Join(dest, entries[0].Name())
	for _, marker := range []string{"wp-config.php", "index.php", "index.html"} {
		if _, err := os.Stat(filepath.Join(inner, marker)); err == nil {
			tmp := dest + ".flatten"
			if err := os.Rename(inner, tmp); err != nil {
				return
			}
			os.Remove(dest)
			if err := os.Rename(tmp, dest); err != nil {
				os.MkdirAll(dest, 0o755)
				os.Rename(tmp, inner)
				return
			}
			logFn("info", "Archive had a wrapping directory "+entries[0].Name()+"; flattened it")
			return
		}
	}
}

func dirStats(root string) (int64, int64, error) {
	var files, bytes int64
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			files++
			if info, err := d.Info(); err == nil {
				bytes += info.Size()
			}
		}
		return nil
	})
	return files, bytes, err
}

// exportFallback mirrors the docroot with lftp and dumps the database from here with mysqldump
// (direct MySQL credentials required) when the helper cannot be reached over HTTP.
func (ex *exporter) exportFallback(ctx context.Context, reason *UnreachableError) (*common.ExportData, error) {
	cfg := ex.cfg
	ex.logFn("warn", fmt.Sprintf("The PHP helper cannot be used (%s); falling back to an FTP mirror with lftp. Emails, cron and DNS are not available; the PHP version is unknown (the target default is used)", reason.Error()))
	conn, docroot, isWP, err := ftpPrepare(ctx, cfg, ex.logFn)
	if err != nil {
		return nil, err
	}
	defer conn.close()

	data := ex.newExportData(nil)
	data.Account.IsWordPress = isWP
	if isWP {
		data.Account.SiteType = "wordpress"
	}

	// database first: fail early when it cannot be dumped
	ex.step(StepDatabases, 1, false)
	dbName := cfg.DBName
	wpDB := map[string]string{}
	if isWP {
		if src, err := conn.readFile(docroot+"/wp-config.php", 256<<10); err == nil {
			wpDB = wpConfigCredentials(src)
			if dbName == "" {
				dbName = wpDB["DB_NAME"]
			}
		} else {
			ex.logFn("warn", "wp-config.php could not be read over FTP: "+err.Error())
		}
	}
	haveCreds := cfg.DBHost != "" && cfg.DBUser != "" && dbName != ""
	switch {
	case haveCreds:
		if _, err := mysqldumpBinary(); err != nil {
			return nil, fmt.Errorf("mysqldump is not installed on the migration server; it is needed for the direct database dump of %s", dbName)
		}
		db, err := ex.mysqldump(ctx, cfg.DBHost, cfg.DBUser, cfg.DBPass, dbName)
		if err != nil {
			return nil, err
		}
		data.Databases = []common.Database{*db}
		data.Account.Databases = []string{dbName}
		data.Account.DBCount = 1
		data.Account.DBSize = HumanBytes(db.Size)
	case isWP:
		hint := ""
		if wpDB["DB_NAME"] != "" {
			hint = fmt.Sprintf(" (wp-config.php uses database %q, user %q, host %q)", wpDB["DB_NAME"], wpDB["DB_USER"], wpDB["DB_HOST"])
		}
		return nil, fmt.Errorf("the helper could not be reached over HTTP (%s), so the database of this WordPress site cannot be dumped. Either allow the request through (the helper is a single PHP file in the docroot called at %s/<random>.php; whitelist %s in the WAF/firewall) or add direct MySQL access to the server record: metadata db_host, db_user, db_pass and db_name%s, with the MySQL server accepting remote connections from this migration server. Then run the migration again",
			reason.Reason, firstOr(cfg.siteURLCandidates(), "https://"+cfg.Host), firstOr([]string{publicIP(ctx)}, "the migration server IP"), hint)
	default:
		ex.logFn("info", "Not a WordPress site and no db_* metadata: no database is exported")
	}

	// files
	ex.step(StepFiles, 2, false)
	dest := filepath.Join(ex.workDir, "files", "domains", ex.host, "public_html")
	if err := ex.lftpMirror(ctx, docroot, dest); err != nil {
		return nil, err
	}
	if n, b, err := dirStats(dest); err == nil {
		data.Account.DiskUsage = HumanBytes(b)
		ex.logFn("info", fmt.Sprintf("Mirror finished: %d files, %s at %s", n, HumanBytes(b), dest))
	}
	return ex.finish(data)
}

func firstOr(list []string, def string) string {
	for _, s := range list {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return def
}

// lftpMirror runs lftp mirror of the docroot into dest (password via the environment).
func (ex *exporter) lftpMirror(ctx context.Context, docroot, dest string) error {
	cfg := ex.cfg
	lftpBin, err := exec.LookPath("lftp")
	if err != nil {
		return fmt.Errorf("lftp is not installed on the migration server; it is needed for the FTP fallback: %w", err)
	}
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	settings := []string{
		"set net:timeout 30", "set net:max-retries 3", "set net:reconnect-interval-base 5",
		"set ssl:verify-certificate no", "set ftp:ssl-allow yes", "set cmd:fail-exit yes",
		"set xfer:clobber yes",
	}
	if cfg.FTPS {
		settings = append(settings, "set ftp:ssl-force yes", "set ftp:ssl-protect-data yes")
	}
	excludes := []string{
		"wp-content/cache/*", "wp-content/*cache*/", "wp-content/ai1wm-backups/*", "wp-content/updraft/*",
		"wp-content/backups-dup-*", "*.wpress", "debug.log", "error_log", ".git/", ".mig-tmp-*/",
	}
	mirror := "mirror --parallel=6 --use-pget-n=3 --no-perms --continue"
	for _, pattern := range excludes {
		mirror += " --exclude-glob " + lftpQuote(pattern)
	}
	mirror += " " + lftpQuote(docroot) + " " + lftpQuote(dest)
	script := strings.Join(append(settings, mirror, "quit"), "; ")
	args := []string{"--env-password", "-u", cfg.Username, "-p", fmt.Sprint(cfg.Port), "-e", script, "ftp://" + cfg.Host}
	ex.logFn("info", fmt.Sprintf("Mirroring %s from %s:%d with lftp (parallel 6, pget 3)", docroot, cfg.Host, cfg.Port))

	cmd := exec.CommandContext(ctx, lftpBin, args...)
	cmd.Env = append(os.Environ(), "LFTP_PASSWORD="+cfg.Password, "HOME="+ex.workDir)
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output

	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		lastLog := time.Now()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				n, b, err := dirStats(dest)
				if err != nil {
					continue
				}
				ex.send(common.MigrationProgress{CurrentStep: StepFiles, CompletedSteps: 2, BytesTransferred: b, Logged: true})
				if time.Since(lastLog) >= time.Minute {
					lastLog = time.Now()
					ex.logFn("info", fmt.Sprintf("Mirror in progress: %d files, %s", n, HumanBytes(b)))
				}
			}
		}
	}()
	err = cmd.Run()
	close(stop)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("lftp mirror failed: %v: %s", err, snippet(strings.ReplaceAll(output.String(), cfg.Password, "***"), 800))
	}
	if out := strings.TrimSpace(output.String()); out != "" {
		ex.logFn("info", "lftp: "+snippet(strings.ReplaceAll(out, cfg.Password, "***"), 500))
	}
	return nil
}

func lftpQuote(s string) string { return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"` }

// mysqldump dumps a database from the migration server into <workDir>/databases/<db>.sql.gz.
func (ex *exporter) mysqldump(ctx context.Context, host, user, pass, dbName string) (*common.Database, error) {
	dbDir := filepath.Join(ex.workDir, "databases")
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		return nil, err
	}
	port := "3306"
	if h, p, err := splitHostPort(host); err == nil {
		host, port = h, p
	}
	args := []string{"-h", host, "-P", port, "-u", user, "--single-transaction", "--quick", "--skip-lock-tables",
		"--routines", "--triggers", "--default-character-set=utf8mb4", "--no-tablespaces", dbName}
	bin, err := mysqldumpBinary()
	if err != nil {
		return nil, err
	}
	ex.logFn("info", fmt.Sprintf("Dumping database %s from %s:%s as %s with %s", dbName, host, port, user, filepath.Base(bin)))
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = append(os.Environ(), "MYSQL_PWD="+pass)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	final := filepath.Join(dbDir, dbName+".sql.gz")
	out, err := os.Create(final)
	if err != nil {
		return nil, err
	}
	gz, _ := gzip.NewWriterLevel(out, gzip.BestSpeed)
	if err := cmd.Start(); err != nil {
		out.Close()
		return nil, fmt.Errorf("mysqldump could not start: %w", err)
	}
	n, copyErr := io.Copy(gz, stdout)
	waitErr := cmd.Wait()
	gz.Close()
	out.Close()
	if waitErr != nil || copyErr != nil {
		os.Remove(final)
		msg := strings.ReplaceAll(strings.TrimSpace(stderr.String()), pass, "***")
		return nil, fmt.Errorf("mysqldump of %s from %s failed: %v %s", dbName, host, firstErr(waitErr, copyErr), snippet(msg, 500))
	}
	if n < 64 {
		os.Remove(final)
		return nil, fmt.Errorf("mysqldump of %s produced no data", dbName)
	}
	fi, _ := os.Stat(final)
	ex.logFn("info", fmt.Sprintf("Database %s dumped: %s raw, %s compressed", dbName, HumanBytes(n), HumanBytes(fi.Size())))
	return &common.Database{Name: dbName, Type: "mysql", Size: n, Charset: "utf8mb4", Users: []common.DBUser{{Username: user, Host: "localhost"}}}, nil
}

// mysqldumpBinary finds mysqldump (or MariaDB's mariadb-dump) on the migration server.
func mysqldumpBinary() (string, error) {
	for _, name := range []string{"mysqldump", "mariadb-dump"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("neither mysqldump nor mariadb-dump is installed on the migration server")
}

func splitHostPort(hostport string) (string, string, error) {
	i := strings.LastIndex(hostport, ":")
	if i <= 0 || strings.Contains(hostport[i+1:], "]") {
		return "", "", fmt.Errorf("no port")
	}
	return hostport[:i], hostport[i+1:], nil
}

func firstErr(errs ...error) error {
	for _, e := range errs {
		if e != nil {
			return e
		}
	}
	return nil
}
