// Package agentless migrates websites that offer no panel access: an FTP login (the tool
// uploads a small PHP helper into the docroot) or a WordPress admin login (the same helper
// wrapped as a plugin, installed through wp-admin). The helper protocol is described in
// docs/agentless-protocol.md.
package agentless

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/storage"
)

// LogFunc receives log lines (level is info, warn or error).
type LogFunc func(level, message string)

// Metadata keys stored on the server record.
const (
	MetaSiteURL    = "site_url"
	MetaFTPS       = "ftps"
	MetaDocroot    = "docroot"
	MetaDBHost     = "db_host"
	MetaDBUser     = "db_user"
	MetaDBPass     = "db_pass"
	MetaDBName     = "db_name"
	MetaLastInfo   = "last_info"    // info payload of the last successful probe
	MetaLastInfoAt = "last_info_at" // RFC3339 time of that probe
)

// tokenTTL is how long an uploaded helper accepts calls.
const tokenTTL = 2 * time.Hour

// IsAgentless reports whether a panel type is one of the agentless sources.
func IsAgentless(panelType string) bool {
	switch common.PanelType(panelType) {
	case common.PanelTypeFTP, common.PanelTypeWordPress:
		return true
	}
	return false
}

// Config is the connection configuration of an agentless source.
type Config struct {
	Mode       common.PanelType // ftp or wordpress
	ServerName string
	Host       string
	Port       int
	Username   string
	Password   string
	SiteURL    string // https://example.com (no trailing slash)
	FTPS       bool   // explicit FTPS (AUTH TLS)
	Docroot    string // FTP path of the docroot; empty = auto-detect
	// Optional direct MySQL credentials for the lftp/mysqldump fallback.
	DBHost string
	DBUser string
	DBPass string
	DBName string
}

// ConfigFromServer builds the Config of an agentless server record.
func ConfigFromServer(server *storage.Server, password string) (*Config, error) {
	if server == nil {
		return nil, fmt.Errorf("server is nil")
	}
	mode := common.PanelType(server.PanelType)
	if !IsAgentless(server.PanelType) {
		return nil, fmt.Errorf("server %q is not an agentless source (panel type %s)", server.Name, server.PanelType)
	}
	meta := parseMetadata(server.Metadata)
	cfg := &Config{
		Mode:       mode,
		ServerName: server.Name,
		Host:       strings.TrimSpace(server.Host),
		Port:       server.Port,
		Username:   server.Username,
		Password:   password,
		SiteURL:    normalizeSiteURL(metaString(meta, MetaSiteURL)),
		FTPS:       metaBool(meta, MetaFTPS),
		Docroot:    strings.TrimSpace(metaString(meta, MetaDocroot)),
		DBHost:     strings.TrimSpace(metaString(meta, MetaDBHost)),
		DBUser:     strings.TrimSpace(metaString(meta, MetaDBUser)),
		DBPass:     metaString(meta, MetaDBPass),
		DBName:     strings.TrimSpace(metaString(meta, MetaDBName)),
	}
	if cfg.Host == "" {
		return nil, fmt.Errorf("server %q has no host", server.Name)
	}
	if cfg.Port <= 0 {
		if mode == common.PanelTypeFTP {
			cfg.Port = 21
		} else {
			cfg.Port = 443
		}
	}
	if cfg.Username == "" {
		return nil, fmt.Errorf("server %q has no username", server.Name)
	}
	if cfg.Password == "" {
		return nil, fmt.Errorf("server %q has no stored password", server.Name)
	}
	if mode == common.PanelTypeWordPress && cfg.SiteURL == "" {
		cfg.SiteURL = "https://" + cfg.Host
	}
	return cfg, nil
}

// siteURLCandidates returns the base URLs to try for reaching the site, in order.
func (c *Config) siteURLCandidates() []string {
	var out []string
	add := func(u string) {
		u = normalizeSiteURL(u)
		if u == "" {
			return
		}
		for _, e := range out {
			if e == u {
				return
			}
		}
		out = append(out, u)
	}
	add(c.SiteURL)
	if c.Mode == common.PanelTypeWordPress {
		return out
	}
	host := c.Host
	add("https://" + host)
	add("http://" + host)
	return out
}

// SiteHost returns the website's host name: the host of site_url when set, otherwise the
// server host. A leading "www." is dropped (the target panel serves www as an alias); in FTP
// mode without a site URL a leading "ftp." is dropped too.
func (c *Config) SiteHost() string {
	host := ""
	if c.SiteURL != "" {
		if u, err := url.Parse(c.SiteURL); err == nil {
			host = u.Hostname()
		}
	}
	if host == "" {
		host = c.Host
		if i := strings.Index(host, ":"); i > 0 {
			host = host[:i]
		}
		if c.Mode == common.PanelTypeFTP {
			host = strings.TrimPrefix(host, "ftp.")
		}
	}
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	return strings.TrimPrefix(host, "www.")
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

// Slug turns a host into the account username used for the migration ("example.com" -> "example_com").
func Slug(host string) string {
	s := slugRe.ReplaceAllString(strings.ToLower(host), "_")
	s = strings.Trim(s, "_")
	if s == "" {
		s = "site"
	}
	if len(s) > 60 {
		s = s[:60]
	}
	return s
}

// normalizeSiteURL trims, adds a scheme when missing and drops the trailing slash.
func normalizeSiteURL(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	u.Fragment = ""
	u.RawQuery = ""
	u.Host = strings.ToLower(u.Host)
	u.Path = strings.TrimRight(u.Path, "/")
	return u.String()
}

func parseMetadata(raw json.RawMessage) map[string]interface{} {
	meta := map[string]interface{}{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &meta)
	}
	return meta
}

func metaString(meta map[string]interface{}, key string) string {
	switch v := meta[key].(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	}
	return ""
}

func metaBool(meta map[string]interface{}, key string) bool {
	switch v := meta[key].(type) {
	case bool:
		return v
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "1", "true", "yes", "on":
			return true
		}
	case float64:
		return v != 0
	}
	return false
}

// flexInt decodes JSON numbers (int or float), numeric strings and null into an int64.
type flexInt int64

func (f *flexInt) UnmarshalJSON(b []byte) error {
	s := strings.TrimSpace(string(b))
	if s == "" || s == "null" || s == "false" {
		*f = 0
		return nil
	}
	if s == "true" {
		*f = 1
		return nil
	}
	s = strings.Trim(s, `"`)
	if s == "" {
		*f = 0
		return nil
	}
	if v, err := strconv.ParseInt(s, 10, 64); err == nil {
		*f = flexInt(v)
		return nil
	}
	if v, err := strconv.ParseFloat(s, 64); err == nil {
		*f = flexInt(v)
		return nil
	}
	// ini-style sizes such as "128M"
	if v, ok := parseIniSize(s); ok {
		*f = flexInt(v)
		return nil
	}
	*f = 0
	return nil
}

// flexBool decodes JSON booleans, 0/1 numbers and "true"/"1" strings.
type flexBool bool

func (f *flexBool) UnmarshalJSON(b []byte) error {
	s := strings.ToLower(strings.Trim(strings.TrimSpace(string(b)), `"`))
	switch s {
	case "true", "1", "yes", "on":
		*f = true
	default:
		if v, err := strconv.ParseFloat(s, 64); err == nil && v != 0 {
			*f = true
		} else {
			*f = false
		}
	}
	return nil
}

func parseIniSize(s string) (int64, bool) {
	s = strings.TrimSpace(strings.ToUpper(s))
	if s == "" {
		return 0, false
	}
	mult := int64(1)
	switch s[len(s)-1] {
	case 'K':
		mult = 1024
	case 'M':
		mult = 1024 * 1024
	case 'G':
		mult = 1024 * 1024 * 1024
	}
	if mult != 1 {
		s = s[:len(s)-1]
	}
	v, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil {
		return 0, false
	}
	return v * mult, true
}

// Info is the helper's `info` payload.
type Info struct {
	PHPVersion       string      `json:"php_version"`
	Exec             flexBool    `json:"exec"`
	WordPress        flexBool    `json:"wordpress"`
	WPVersion        string      `json:"wp_version"`
	TablePrefix      string      `json:"table_prefix"`
	Multisite        flexBool    `json:"multisite"`
	SiteURL          string      `json:"site_url"`
	DB               InfoDB      `json:"db"`
	Docroot          string      `json:"docroot"`
	TmpDir           string      `json:"tmp_dir"`
	DiskFree         flexInt     `json:"disk_free"`
	MaxExecutionTime flexInt     `json:"max_execution_time"`
	MemoryLimit      string      `json:"memory_limit"`
	Files            InfoFiles   `json:"files"`
	Plugins          InfoPlugins `json:"plugins"`

	// Raw is the payload exactly as the helper returned it (stored as last_info, shown by the UI).
	Raw json.RawMessage `json:"-"`
	// Warnings collected while probing (for example a cleanup that did not finish).
	Warnings []string `json:"-"`
}

// InfoDB holds the database credentials found in wp-config.php (never the password).
type InfoDB struct {
	Name string `json:"name"`
	User string `json:"user"`
	Host string `json:"host"`
}

// InfoFiles is the docroot walk summary.
type InfoFiles struct {
	Count   flexInt  `json:"count"`
	Bytes   flexInt  `json:"bytes"`
	Partial flexBool `json:"partial"`
}

// InfoPlugins lists notable WordPress plugins.
type InfoPlugins struct {
	Active         []string `json:"active"`
	LiteSpeedCache flexBool `json:"litespeed_cache"`
	WPRocket       flexBool `json:"wp_rocket"`
	ObjectCache    flexBool `json:"object_cache"`
}

// PHPMajorMinor returns the PHP version as "major.minor" ("7.4.33" -> "7.4").
func (i *Info) PHPMajorMinor() string {
	if i == nil {
		return ""
	}
	return MajorMinor(i.PHPVersion)
}

// MajorMinor keeps the first two numeric components of a version string.
func MajorMinor(v string) string {
	v = strings.TrimSpace(v)
	m := regexp.MustCompile(`^(\d+)\.(\d+)`).FindStringSubmatch(v)
	if m == nil {
		return ""
	}
	return m[1] + "." + m[2]
}

// DiskUsed formats the walked file size for the accounts list ("1.2 GB", "1.2 GB+" when the walk was cut).
func (i *Info) DiskUsed() string {
	if i == nil || i.Files.Bytes <= 0 {
		return ""
	}
	s := HumanBytes(int64(i.Files.Bytes))
	if bool(i.Files.Partial) {
		s += "+"
	}
	return s
}

// Databases returns the database names known from the info (0 or 1).
func (i *Info) Databases() []string {
	if i == nil || i.DB.Name == "" {
		return nil
	}
	return []string{i.DB.Name}
}

// Summary is a one-line description for the connection test message.
func (i *Info) Summary() string {
	if i == nil {
		return ""
	}
	var parts []string
	if bool(i.WordPress) {
		v := i.WPVersion
		if v == "" {
			v = "version unknown"
		}
		parts = append(parts, "WordPress "+v)
		if bool(i.Multisite) {
			parts = append(parts, "multisite")
		}
	} else {
		parts = append(parts, "not a WordPress site")
	}
	if i.PHPVersion != "" {
		parts = append(parts, "PHP "+i.PHPVersion)
	}
	if i.DB.Name != "" {
		parts = append(parts, "database "+i.DB.Name)
	}
	if i.Files.Count > 0 || i.Files.Bytes > 0 {
		f := fmt.Sprintf("%d files (%s)", int64(i.Files.Count), HumanBytes(int64(i.Files.Bytes)))
		if bool(i.Files.Partial) {
			f += ", count cut short"
		}
		parts = append(parts, f)
	}
	if bool(i.Exec) {
		parts = append(parts, "exec available")
	} else {
		parts = append(parts, "no exec (pure PHP dump/archive)")
	}
	return strings.Join(parts, ", ")
}

func parseInfo(raw json.RawMessage) (*Info, error) {
	var info Info
	if err := json.Unmarshal(raw, &info); err != nil {
		return nil, fmt.Errorf("info payload could not be decoded: %w", err)
	}
	info.Raw = raw
	return &info, nil
}

// LastInfo returns the info stored by the last successful probe of a server, if any.
func LastInfo(server *storage.Server) (*Info, time.Time, bool) {
	if server == nil {
		return nil, time.Time{}, false
	}
	meta := parseMetadata(server.Metadata)
	rawInfo, ok := meta[MetaLastInfo]
	if !ok || rawInfo == nil {
		return nil, time.Time{}, false
	}
	b, err := json.Marshal(rawInfo)
	if err != nil || len(b) < 2 || b[0] != '{' {
		return nil, time.Time{}, false
	}
	info, err := parseInfo(b)
	if err != nil {
		return nil, time.Time{}, false
	}
	at, _ := time.Parse(time.RFC3339, metaString(meta, MetaLastInfoAt))
	return info, at, true
}

// MetadataWithInfo returns the server metadata with last_info/last_info_at set from a probe.
func MetadataWithInfo(current json.RawMessage, info *Info, at time.Time) json.RawMessage {
	meta := parseMetadata(current)
	if info != nil && len(info.Raw) > 0 {
		meta[MetaLastInfo] = json.RawMessage(info.Raw)
		meta[MetaLastInfoAt] = at.UTC().Format(time.RFC3339)
	} else {
		delete(meta, MetaLastInfo)
		delete(meta, MetaLastInfoAt)
	}
	b, err := json.Marshal(meta)
	if err != nil {
		return current
	}
	return b
}

// HumanBytes formats a byte count ("1.2 GB").
func HumanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}

func randHex(n int) string {
	b := make([]byte, (n+1)/2)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(b)[:n]
}

// Probe connects to the source, installs the helper, runs `info` and removes the helper again.
// The returned Info is what the connection test shows and what the accounts list is built from.
func Probe(ctx context.Context, server *storage.Server, password string, logFn LogFunc) (*Info, error) {
	if logFn == nil {
		logFn = func(string, string) {}
	}
	cfg, err := ConfigFromServer(server, password)
	if err != nil {
		return nil, err
	}
	sess, err := open(ctx, cfg, logFn)
	if err != nil {
		return nil, err
	}
	info := sess.info
	if err := sess.close(ctx); err != nil {
		logFn("warn", "Helper cleanup: "+err.Error())
		info.Warnings = append(info.Warnings, "cleanup did not finish: "+err.Error())
	}
	return info, nil
}
