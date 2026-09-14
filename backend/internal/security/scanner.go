// Package security scans an exported website on the staging (middle) server for malware,
// backdoors, SEO spam and tampered WordPress core files before anything is uploaded to the
// target, and can quarantine or restore what it found. The signatures follow MVN's
// WordPress incident-cleanup workflow (docs/wordpress-incident-cleanup.md).
package security

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
)

// Severity of a finding.
type Severity string

const (
	SevCritical Severity = "critical"
	SevHigh     Severity = "high"
	SevMedium   Severity = "medium"
	SevInfo     Severity = "info"
)

// Actions the cleaner knows how to apply.
const (
	ActionQuarantine  = "quarantine"   // move the file/dir to the quarantine directory on the staging server
	ActionRestoreCore = "restore_core" // replace a modified core file with the pristine copy from wordpress.org
	ActionRemoveLines = "remove_lines" // strip injected directives (auto_prepend_file ...) from a config file
	ActionReport      = "report"       // no automatic action; the operator reviews it
)

// Finding is one thing the scanner flagged.
type Finding struct {
	ID        string   `json:"id"`
	Severity  Severity `json:"severity"`
	Category  string   `json:"category"`
	Domain    string   `json:"domain"`
	Path      string   `json:"path"` // relative to the docroot, or "db:<table>" for database findings
	Evidence  string   `json:"evidence,omitempty"`
	Line      int      `json:"line,omitempty"`
	Action    string   `json:"action"`
	Cleanable bool     `json:"cleanable"`
	Cleaned   bool     `json:"cleaned,omitempty"`
	Note      string   `json:"note,omitempty"`
}

// AdminUser is a WordPress administrator found in the database dump.
type AdminUser struct {
	ID    int    `json:"id"`
	Login string `json:"login"`
	Email string `json:"email"`
}

// DomainSummary describes one scanned docroot.
type DomainSummary struct {
	Domain       string `json:"domain"`
	DocRoot      string `json:"-"`
	Files        int    `json:"files"`
	Bytes        int64  `json:"bytes"`
	WordPress    bool   `json:"wordpress"`
	CoreVersion  string `json:"core_version,omitempty"`
	CoreChecked  bool   `json:"core_checked"`
	CoreModified int    `json:"core_modified"`
	CoreExtra    int    `json:"core_extra"`
	CoreMissing  int    `json:"core_missing"`
	CoreNote     string `json:"core_note,omitempty"`
}

// CleanupResult records what Clean did.
type CleanupResult struct {
	At            time.Time `json:"at"`
	QuarantineDir string    `json:"quarantine_dir"`
	Quarantined   []string  `json:"quarantined"`
	Restored      []string  `json:"restored"`
	LinesRemoved  []string  `json:"lines_removed"`
	Skipped       []string  `json:"skipped"`
	Errors        []string  `json:"errors"`
}

// Report is the full scan result stored with the migration.
type Report struct {
	ScannedAt    time.Time        `json:"scanned_at"`
	DurationMs   int64            `json:"duration_ms"`
	Domains      []DomainSummary  `json:"domains"`
	FilesScanned int              `json:"files_scanned"`
	BytesScanned int64            `json:"bytes_scanned"`
	Findings     []Finding        `json:"findings"`
	Counts       map[Severity]int `json:"counts"`
	Cleanable    int              `json:"cleanable"`
	AdminUsers   []AdminUser      `json:"admin_users"`
	Databases    []string         `json:"databases"`
	ClamAV       string           `json:"clamav"`
	Notes        []string         `json:"notes,omitempty"`
	Cleanup      *CleanupResult   `json:"cleanup,omitempty"`
}

// NeedsReview reports whether the operator has to look at the findings before the import continues.
func (r *Report) NeedsReview() bool {
	for _, f := range r.Findings {
		if f.Severity != SevInfo {
			return true
		}
	}
	return false
}

// Summary is a one-line human summary for logs.
func (r *Report) Summary() string {
	if len(r.Findings) == 0 {
		return fmt.Sprintf("no findings in %d files", r.FilesScanned)
	}
	return fmt.Sprintf("%d finding(s): %d critical, %d high, %d medium, %d info (%d auto-cleanable) in %d files",
		len(r.Findings), r.Counts[SevCritical], r.Counts[SevHigh], r.Counts[SevMedium], r.Counts[SevInfo], r.Cleanable, r.FilesScanned)
}

// Options tune a scan.
type Options struct {
	CacheDir        string // where core checksums and pristine core archives are cached
	SkipCore        bool   // do not contact wordpress.org
	SkipClamAV      bool
	MaxContentBytes int64 // files larger than this are not content-scanned (default 3 MB)
	Log             func(level, message string)
}

func (o Options) logf(level, format string, args ...interface{}) {
	if o.Log != nil {
		o.Log(level, fmt.Sprintf(format, args...))
	}
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

type signature struct {
	re       *regexp.Regexp
	category string
	sev      Severity
	action   string
	minHits  int
	note     string
}

var (
	phpExt  = map[string]bool{".php": true, ".phtml": true, ".php5": true, ".php7": true, ".phar": true, ".inc": true}
	jsExt   = map[string]bool{".js": true, ".html": true, ".htm": true}
	confExt = map[string]bool{".htaccess": true, ".user.ini": true, "php.ini": true, "php5.ini": true}

	codeSignatures = []signature{
		{regexp.MustCompile(`(?i)\b(eval|assert|system|exec|shell_exec|passthru|popen|proc_open)\s*\(\s*(\$_(POST|GET|REQUEST|COOKIE|SERVER)\b|base64_decode|gzinflate|gzuncompress|gzdecode|str_rot13|strrev|urldecode|hex2bin|rawurldecode)`),
			"webshell", SevCritical, ActionQuarantine, 1, "code executes decoded or request-supplied input"},
		{regexp.MustCompile(`\$_(POST|GET|REQUEST|COOKIE)\s*\[[^\]]+\]\s*\(`),
			"webshell", SevCritical, ActionQuarantine, 1, "function name taken from the request"},
		{regexp.MustCompile(`(?i)base64_decode\s*\(\s*['"][A-Za-z0-9+/=]{400,}`),
			"obfuscation", SevCritical, ActionQuarantine, 1, "large embedded base64 payload"},
		{regexp.MustCompile(`(?i)geTALLhEaDerS|clickhitriver|hitriver\.`),
			"fake_captcha", SevCritical, ActionQuarantine, 1, "known fake-captcha / clipboard-hijack indicator"},
		{regexp.MustCompile(`(?i)navigator\.clipboard[^\n]{0,200}execCommand|String\.fromCharCode[^\n]{0,160}\batob\s*\(|\batob\s*\([^\n]{0,160}String\.fromCharCode`),
			"fake_captcha", SevHigh, ActionQuarantine, 1, "clipboard hijack / decoded script"},
		{regexp.MustCompile(`(?i)(window\.location(\.href)?|location\.href|document\.location)\s*=\s*(atob|decodeURIComponent|unescape)\s*\(`),
			"redirect", SevHigh, ActionQuarantine, 1, "obfuscated JavaScript redirect"},
		{regexp.MustCompile(`(?i)document\.write\s*\(\s*(unescape|atob|decodeURIComponent)\s*\(`),
			"obfuscation", SevHigh, ActionQuarantine, 1, "decoded script injection"},
		{regexp.MustCompile(`\bgoto\s+[A-Za-z_]\w*\s*;`),
			"obfuscation", SevHigh, ActionQuarantine, 15, "goto-obfuscated PHP"},
		{regexp.MustCompile(`(?:\\x[0-9a-fA-F]{2}){8,}`),
			"obfuscation", SevHigh, ActionReport, 1, "long hex-escaped string"},
		{regexp.MustCompile(`(?:chr\s*\(\s*\d+\s*\)\s*\.\s*){8,}`),
			"obfuscation", SevHigh, ActionReport, 1, "chr() concatenation chain"},
		{regexp.MustCompile(`(?i)preg_replace\s*\(\s*['"][^'"]*/[a-z]*e[a-z]*['"]`),
			"webshell", SevHigh, ActionReport, 1, "preg_replace with /e (code execution)"},
		{regexp.MustCompile(`(?i)hide_my_plugin|add_filter\s*\(\s*['"]all_plugins['"]`),
			"hidden_plugin", SevHigh, ActionReport, 1, "code that hides plugins from the plugin list"},
		{regexp.MustCompile(`(?i)\bwp_vcd\b|wp-vcd|class\.theme-modules|wp_tmp\b`),
			"known_malware", SevHigh, ActionReport, 1, "reference to the wp-vcd malware family"},
		{regexp.MustCompile(`(?i)verify you are human|i am not a robot`),
			"fake_captcha", SevMedium, ActionReport, 1, "captcha-like text (check for a fake captcha page)"},
		{regexp.MustCompile(`(?i)\bcreate_function\s*\(`),
			"deprecated_exec", SevMedium, ActionReport, 1, "create_function (removed in PHP 8, common in injected code)"},
		{regexp.MustCompile(`(?i)\beval\s*\(`),
			"eval", SevMedium, ActionReport, 1, "eval() present; review manually"},
	}

	confSignatures = []signature{
		{regexp.MustCompile(`(?im)^\s*(auto_prepend_file|auto_append_file)\s*=`),
			"config_injection", SevCritical, ActionRemoveLines, 1, "PHP prepend/append directive in a config file"},
		{regexp.MustCompile(`(?im)php_(value|flag)\s+(auto_prepend_file|auto_append_file)`),
			"config_injection", SevCritical, ActionRemoveLines, 1, "PHP prepend/append directive in .htaccess"},
		{regexp.MustCompile(`(?im)^\s*(AddHandler|AddType|SetHandler)\s+[^\n]*php`),
			"config_injection", SevHigh, ActionReport, 1, "PHP handler mapping (critical when inside uploads)"},
		{regexp.MustCompile(`(?i)<script|<iframe`),
			"config_injection", SevHigh, ActionQuarantine, 1, "HTML/script inside a config file"},
		{regexp.MustCompile(`(?im)^\s*RewriteRule\s+[^\n]*\s+https?://`),
			"redirect_rule", SevMedium, ActionReport, 1, "rewrite to an absolute URL; verify it targets the site's own domain"},
	}

	knownShellName    = regexp.MustCompile(`(?i)^(shell|c99|r57|wso|b374k|wp-tmp|wp-feed|wp-vcd|class\.theme-modules|wp-cache-[a-z0-9]{6,}|mailer|leaf|alfa|filesman|indoxploit|marijuana)\.php$`)
	toolFileName      = regexp.MustCompile(`(?i)^(adminer|adminer-[0-9.]+|phpinfo|info|test|db|database)\.php$`)
	backupPHPName     = regexp.MustCompile(`(?i)\.php\.(bak|suspected|old|orig|save|txt)$|\.(phtml|php5|php7|phar)$`)
	assetDirPHP       = regexp.MustCompile(`(?i)/(css|js|fonts|images|img|assets/images)/[^/]+\.php$`)
	suspiciousDirName = regexp.MustCompile(`(?i)^(security|seo|backup|analytics|social|cache|update|core|wp-cache|system|ajax)[-_][0-9]{8,}$|^[a-z]+[-_][0-9]{10,}$`)
	uploadsPHP        = regexp.MustCompile(`(?i)(^|/)wp-content/uploads/.*\.(php|phtml|php5|php7|phar)$`)
	themeUserPHP      = regexp.MustCompile(`(?i)(^|/)wp-content/themes/[^/]+/user\.php$`)
	spamKeywords      = regexp.MustCompile(`(?i)\b(viagra|cialis|casino|replica rolex|poker|betting|payday loan|xanax|levitra)\b`)
)

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

type scanner struct {
	opts     Options
	report   *Report
	findings map[string]*Finding
}

// Scan inspects every exported docroot and database dump of the account.
func Scan(ctx context.Context, data *common.ExportData, opts Options) (*Report, error) {
	if data == nil || data.FilesPath == "" {
		return nil, fmt.Errorf("nothing to scan: export has no files path")
	}
	if opts.MaxContentBytes <= 0 {
		opts.MaxContentBytes = 3 << 20
	}
	start := time.Now()
	s := &scanner{opts: opts, report: &Report{ScannedAt: start, Counts: map[Severity]int{}}, findings: map[string]*Finding{}}

	for _, d := range data.Domains {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		docroot := filepath.Join(data.FilesPath, "domains", d.Name, "public_html")
		if st, err := os.Stat(docroot); err != nil || !st.IsDir() {
			s.report.Notes = append(s.report.Notes, fmt.Sprintf("%s: no exported docroot at %s", d.Name, docroot))
			continue
		}
		s.scanDocroot(ctx, d.Name, docroot)
	}

	dumpDir := filepath.Join(filepath.Dir(data.FilesPath), "databases")
	if entries, err := os.ReadDir(dumpDir); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if !strings.HasSuffix(name, ".sql") && !strings.HasSuffix(name, ".sql.gz") {
				continue
			}
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			s.report.Databases = append(s.report.Databases, name)
			if err := s.scanDump(ctx, filepath.Join(dumpDir, name), data.Account.Domain); err != nil {
				s.report.Notes = append(s.report.Notes, fmt.Sprintf("database dump %s not fully scanned: %v", name, err))
			}
		}
	}

	if !opts.SkipClamAV {
		s.runClamAV(ctx, data)
	} else {
		s.report.ClamAV = "skipped"
	}

	s.finish()
	s.report.DurationMs = time.Since(start).Milliseconds()
	return s.report, nil
}

func (s *scanner) add(f Finding) {
	key := f.Domain + "|" + f.Category + "|" + f.Path
	if existing, ok := s.findings[key]; ok {
		// keep the most severe evidence for the same file/category
		if rank(f.Severity) > rank(existing.Severity) {
			*existing = f
			existing.ID = shortHash(key)
		}
		return
	}
	f.ID = shortHash(key)
	if f.Action == "" {
		f.Action = ActionReport
	}
	f.Cleanable = f.Action != ActionReport
	nf := f
	s.findings[key] = &nf
}

func (s *scanner) finish() {
	list := make([]Finding, 0, len(s.findings))
	for _, f := range s.findings {
		list = append(list, *f)
	}
	sort.Slice(list, func(i, j int) bool {
		if rank(list[i].Severity) != rank(list[j].Severity) {
			return rank(list[i].Severity) > rank(list[j].Severity)
		}
		if list[i].Domain != list[j].Domain {
			return list[i].Domain < list[j].Domain
		}
		return list[i].Path < list[j].Path
	})
	s.report.Findings = list
	s.report.Counts = map[Severity]int{}
	s.report.Cleanable = 0
	for _, f := range list {
		s.report.Counts[f.Severity]++
		if f.Cleanable {
			s.report.Cleanable++
		}
	}
}

func rank(sev Severity) int {
	switch sev {
	case SevCritical:
		return 4
	case SevHigh:
		return 3
	case SevMedium:
		return 2
	default:
		return 1
	}
}

func shortHash(s string) string {
	h := sha1.Sum([]byte(s))
	return hex.EncodeToString(h[:6])
}

// scanDocroot walks one website root.
func (s *scanner) scanDocroot(ctx context.Context, domain, docroot string) {
	sum := DomainSummary{Domain: domain, DocRoot: docroot}
	if _, err := os.Stat(filepath.Join(docroot, "wp-includes", "version.php")); err == nil {
		sum.WordPress = true
	}
	core := map[string]string{}
	if sum.WordPress && !s.opts.SkipCore {
		ver := detectWPVersion(docroot)
		sum.CoreVersion = ver
		if ver != "" {
			checksums, err := fetchCoreChecksums(ctx, s.opts.CacheDir, ver)
			if err != nil {
				sum.CoreNote = fmt.Sprintf("core integrity not checked: %v", err)
				s.opts.logf("warn", "%s: %s", domain, sum.CoreNote)
			} else {
				core = checksums
				sum.CoreChecked = true
			}
		} else {
			sum.CoreNote = "core integrity not checked: WordPress version not detected"
		}
	}

	_ = filepath.WalkDir(docroot, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		rel, _ := filepath.Rel(docroot, path)
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		if d.IsDir() {
			if strings.HasPrefix(rel, "wp-content/") && suspiciousDirName.MatchString(d.Name()) {
				s.add(Finding{Severity: SevHigh, Category: "suspicious_dir", Domain: domain, Path: rel, Action: ActionQuarantine,
					Evidence: "directory name with a timestamp suffix", Note: "typical drop location for injected plugins"})
			}
			if rel == "wp-content/plugins" {
				s.checkPlugins(domain, path)
			}
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		sum.Files++
		sum.Bytes += info.Size()
		s.report.FilesScanned++
		s.report.BytesScanned += info.Size()
		s.scanFile(domain, docroot, rel, path, info.Size(), core)
		return nil
	})

	if sum.CoreChecked {
		modified, extra, missing := s.checkCore(domain, docroot, core)
		sum.CoreModified, sum.CoreExtra, sum.CoreMissing = modified, extra, missing
	}
	s.report.Domains = append(s.report.Domains, sum)
}

// scanFile applies name, location and content checks to one file.
func (s *scanner) scanFile(domain, docroot, rel, abs string, size int64, core map[string]string) {
	base := filepath.Base(rel)
	ext := strings.ToLower(filepath.Ext(base))
	lowerBase := strings.ToLower(base)
	isPHP := phpExt[ext]
	isJS := jsExt[ext]
	isConf := lowerBase == ".htaccess" || lowerBase == ".user.ini" || lowerBase == "php.ini" || lowerBase == "php5.ini"
	inCore := strings.HasPrefix(rel, "wp-admin/") || strings.HasPrefix(rel, "wp-includes/")
	inUploads := strings.HasPrefix(rel, "wp-content/uploads/")

	// Name and location checks
	if knownShellName.MatchString(base) {
		s.add(Finding{Severity: SevCritical, Category: "known_shell", Domain: domain, Path: rel, Action: ActionQuarantine, Evidence: "file name of a known web shell / malware dropper"})
	}
	if toolFileName.MatchString(base) && !inCore {
		s.add(Finding{Severity: SevMedium, Category: "exposed_tool", Domain: domain, Path: rel, Action: ActionReport, Evidence: "database/PHP info tool left on the site"})
	}
	if backupPHPName.MatchString(base) && !inCore {
		s.add(Finding{Severity: SevHigh, Category: "suspicious_name", Domain: domain, Path: rel, Action: ActionQuarantine, Evidence: "backup/alternate PHP extension that some servers still execute"})
	}
	if uploadsPHP.MatchString(rel) {
		if !(lowerBase == "index.php" && size <= 200) {
			s.add(Finding{Severity: SevCritical, Category: "php_in_uploads", Domain: domain, Path: rel, Action: ActionQuarantine, Evidence: "PHP file inside wp-content/uploads"})
		}
	}
	if themeUserPHP.MatchString(rel) {
		s.add(Finding{Severity: SevHigh, Category: "suspicious_name", Domain: domain, Path: rel, Action: ActionQuarantine, Evidence: "user.php inside a theme"})
	}
	if assetDirPHP.MatchString("/"+rel) && !inCore && !inUploads {
		s.add(Finding{Severity: SevHigh, Category: "php_in_assets", Domain: domain, Path: rel, Action: ActionReport, Evidence: "PHP file inside a css/js/images directory"})
	}
	if inUploads && lowerBase == ".htaccess" {
		// handled by config signatures below (AddHandler in uploads is critical)
	}

	// Content checks
	if !(isPHP || isJS || isConf) {
		return
	}
	if size > s.opts.MaxContentBytes {
		s.report.Notes = append(s.report.Notes, fmt.Sprintf("%s: %s (%d MB) not content-scanned", domain, rel, size>>20))
		return
	}
	content, err := os.ReadFile(abs)
	if err != nil {
		return
	}
	text := string(content)

	if isConf {
		for _, sig := range confSignatures {
			if loc := sig.re.FindStringIndex(text); loc != nil {
				sev, action := sig.sev, sig.action
				if inUploads && sig.category == "config_injection" {
					sev, action = SevCritical, ActionQuarantine
				}
				if sig.category == "redirect_rule" && strings.Contains(strings.ToLower(text[loc[0]:loc[1]]), strings.ToLower(domain)) {
					continue // redirect to the site's own domain
				}
				s.add(Finding{Severity: sev, Category: sig.category, Domain: domain, Path: rel, Action: action,
					Evidence: snippet(text, loc[0]), Line: lineOf(text, loc[0]), Note: sig.note})
			}
		}
		return
	}

	// Core files are covered by the checksum comparison; content heuristics there only add noise.
	if inCore && len(core) > 0 {
		return
	}
	for _, sig := range codeSignatures {
		if isJS && sig.category != "fake_captcha" && sig.category != "redirect" && sig.category != "obfuscation" {
			continue
		}
		if sig.minHits > 1 {
			if n := len(sig.re.FindAllStringIndex(text, sig.minHits)); n >= sig.minHits {
				loc := sig.re.FindStringIndex(text)
				s.add(Finding{Severity: sig.sev, Category: sig.category, Domain: domain, Path: rel, Action: sig.action,
					Evidence: fmt.Sprintf("%d occurrences; %s", n, snippet(text, loc[0])), Line: lineOf(text, loc[0]), Note: sig.note})
			}
			continue
		}
		if loc := sig.re.FindStringIndex(text); loc != nil {
			s.add(Finding{Severity: sig.sev, Category: sig.category, Domain: domain, Path: rel, Action: sig.action,
				Evidence: snippet(text, loc[0]), Line: lineOf(text, loc[0]), Note: sig.note})
		}
	}
}

// checkPlugins flags plugin directories that do not look like real plugins.
func (s *scanner) checkPlugins(domain, pluginsDir string) {
	entries, err := os.ReadDir(pluginsDir)
	if err != nil {
		return
	}
	header := regexp.MustCompile(`(?i)Plugin Name\s*:`)
	for _, e := range entries {
		name := e.Name()
		if name == "index.php" || name == "hello.php" || name == ".htaccess" {
			continue
		}
		if !e.IsDir() {
			content, _ := os.ReadFile(filepath.Join(pluginsDir, name))
			if !header.Match(content) {
				s.add(Finding{Severity: SevHigh, Category: "unknown_plugin", Domain: domain, Path: "wp-content/plugins/" + name, Action: ActionQuarantine,
					Evidence: "loose PHP file in the plugins directory without a plugin header"})
			}
			continue
		}
		dir := filepath.Join(pluginsDir, name)
		hasReadme := false
		hasHeader := false
		files, _ := os.ReadDir(dir)
		for _, f := range files {
			ln := strings.ToLower(f.Name())
			if ln == "readme.txt" || ln == "readme.md" {
				hasReadme = true
			}
			if strings.HasSuffix(ln, ".php") && !hasHeader {
				content, err := os.ReadFile(filepath.Join(dir, f.Name()))
				if err == nil && header.Match(content) {
					hasHeader = true
				}
			}
		}
		if !hasHeader {
			s.add(Finding{Severity: SevHigh, Category: "unknown_plugin", Domain: domain, Path: "wp-content/plugins/" + name, Action: ActionReport,
				Evidence: "no PHP file with a Plugin Name header", Note: "WordPress would not list this as a plugin; check what it contains"})
		} else if !hasReadme {
			s.add(Finding{Severity: SevMedium, Category: "plugin_no_readme", Domain: domain, Path: "wp-content/plugins/" + name, Action: ActionReport,
				Evidence: "plugin without readme.txt (custom or premium plugins are normal; injected ones too)"})
		}
	}
}

// runClamAV adds findings from clamscan when it is installed on the staging server.
func (s *scanner) runClamAV(ctx context.Context, data *common.ExportData) {
	bin, err := exec.LookPath("clamscan")
	if err != nil {
		s.report.ClamAV = "not installed"
		return
	}
	cctx, cancel := context.WithTimeout(ctx, 20*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(cctx, bin, "-r", "-i", "--no-summary", filepath.Join(data.FilesPath, "domains"))
	out, _ := cmd.CombinedOutput()
	infected := 0
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasSuffix(line, " FOUND") {
			continue
		}
		idx := strings.LastIndex(line, ": ")
		if idx < 0 {
			continue
		}
		path := line[:idx]
		sigName := strings.TrimSuffix(line[idx+2:], " FOUND")
		rel := path
		domain := ""
		if r, err := filepath.Rel(filepath.Join(data.FilesPath, "domains"), path); err == nil {
			parts := strings.SplitN(filepath.ToSlash(r), "/", 3)
			if len(parts) == 3 {
				domain, rel = parts[0], parts[2]
			}
		}
		infected++
		s.add(Finding{Severity: SevCritical, Category: "clamav", Domain: domain, Path: rel, Action: ActionQuarantine, Evidence: sigName})
	}
	if cctx.Err() != nil {
		s.report.ClamAV = "timed out"
		return
	}
	s.report.ClamAV = fmt.Sprintf("%d infected", infected)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func snippet(text string, at int) string {
	start := at - 40
	if start < 0 {
		start = 0
	}
	end := at + 120
	if end > len(text) {
		end = len(text)
	}
	s := strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return ' '
		}
		if r < 32 {
			return -1
		}
		return r
	}, text[start:end])
	return strings.TrimSpace(s)
}

func lineOf(text string, at int) int {
	return strings.Count(text[:at], "\n") + 1
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
