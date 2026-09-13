// Package enhance implements Enhance panel operations via the Enhance API v2 plus
// root SSH access to the cluster node that hosts the migrated website.
//
// Enhance is a cluster: the control panel (console) is one server, websites live on
// application nodes. Files, databases and permissions must therefore be handled on
// the node returned by the API for the selected server, never on the console.
package enhance

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/ssh"
)

// LogFunc receives log lines from the Enhance module (level: info|warn|error)
type LogFunc func(level, message string)

// Enhance implements Enhance import operations
type Enhance struct {
	config                *common.ConnectionConfig
	apiKey                string
	httpClient            *http.Client
	connected             bool
	targetClusterServerID string
	logFn                 LogFunc

	// SSH session to the cluster node that hosts the website
	node     *ssh.Client
	nodeHost string

	warnings []string
	tmpPaths []string // files we created on the node and must remove
	websites map[string]*EnhanceWebsite
}

// New creates a new Enhance panel instance
func New() *Enhance {
	return &Enhance{
		httpClient: &http.Client{Timeout: 60 * time.Second},
		websites:   make(map[string]*EnhanceWebsite),
	}
}

// SetLogger routes module log lines to the given function (in addition to stdout)
func (e *Enhance) SetLogger(fn LogFunc) { e.logFn = fn }

// SetTargetClusterServerID sets the cluster server on which websites are created
func (e *Enhance) SetTargetClusterServerID(serverID string) { e.targetClusterServerID = serverID }

// Warnings returns the non-fatal problems collected during import
func (e *Enhance) Warnings() []string { return e.warnings }

func (e *Enhance) logf(level, format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	fmt.Printf("[enhance][%s] %s\n", level, msg)
	if e.logFn != nil {
		e.logFn(level, msg)
	}
}

func (e *Enhance) warnf(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	e.warnings = append(e.warnings, msg)
	e.logf("warn", "%s", msg)
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

// ConnectAPI prepares API access (no SSH). This is all that is needed for
// listing servers/orgs/websites.
func (e *Enhance) ConnectAPI(ctx context.Context, config *common.ConnectionConfig, apiKey string) error {
	if config == nil || config.APIEndpoint == "" {
		return fmt.Errorf("Enhance API endpoint not configured")
	}
	if apiKey == "" {
		return fmt.Errorf("Enhance API key not configured")
	}
	e.config = config
	e.apiKey = apiKey
	e.connected = true
	return nil
}

// ConnectWithCredentials is kept for callers that only need the API.
func (e *Enhance) ConnectWithCredentials(ctx context.Context, config *common.ConnectionConfig, apiKey string, password string, privateKey []byte) error {
	return e.ConnectAPI(ctx, config, apiKey)
}

// ConnectNode opens root SSH (+SFTP) to the cluster node that hosts the website.
func (e *Enhance) ConnectNode(ctx context.Context, nodeConfig *common.ConnectionConfig, password string, privateKey []byte) error {
	client := ssh.NewClient()
	if err := client.Connect(ctx, nodeConfig, password, privateKey); err != nil {
		return fmt.Errorf("SSH to node %s failed: %w", nodeConfig.Host, err)
	}
	if err := client.ConnectSFTP(); err != nil {
		client.Disconnect()
		return fmt.Errorf("SFTP to node %s failed: %w", nodeConfig.Host, err)
	}
	out, err := client.RunCommand(ctx, "hostname; id -u")
	if err != nil {
		client.Disconnect()
		return fmt.Errorf("node %s: cannot run commands: %w", nodeConfig.Host, err)
	}
	lines := strings.Fields(out)
	if len(lines) == 2 && lines[1] != "0" {
		client.Disconnect()
		return fmt.Errorf("node %s: SSH user %s is not root (uid %s); root is required", nodeConfig.Host, nodeConfig.Username, lines[1])
	}
	e.node = client
	e.nodeHost = nodeConfig.Host
	e.logf("info", "Connected to cluster node %s (hostname %s) as root", nodeConfig.Host, strings.Join(lines[:1], ""))
	return nil
}

// Disconnect closes the node SSH session
func (e *Enhance) Disconnect() error {
	e.connected = false
	if e.node != nil {
		err := e.node.Disconnect()
		e.node = nil
		return err
	}
	return nil
}

// TestConnection tests API access
func (e *Enhance) TestConnection(ctx context.Context) error {
	if !e.connected {
		return fmt.Errorf("not connected")
	}
	if _, err := e.apiRequest(ctx, "GET", "/servers", nil); err != nil {
		return fmt.Errorf("API connection failed: %w", err)
	}
	return nil
}

// GetPanelType returns the panel type
func (e *Enhance) GetPanelType() common.PanelType { return common.PanelTypeEnhance }

// apiRequest performs a JSON request against the Enhance API (v2 prefix added automatically)
func (e *Enhance) apiRequest(ctx context.Context, method, endpoint string, body interface{}) ([]byte, error) {
	if !strings.HasPrefix(endpoint, "/v2") {
		endpoint = "/v2" + endpoint
	}
	url := strings.TrimRight(e.config.APIEndpoint, "/") + endpoint

	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+e.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, &APIError{Status: resp.StatusCode, Method: method, Endpoint: endpoint, Body: strings.TrimSpace(string(respBody))}
	}
	return respBody, nil
}

// APIError is an HTTP error from the Enhance API
type APIError struct {
	Status   int
	Method   string
	Endpoint string
	Body     string
}

func (a *APIError) Error() string {
	return fmt.Sprintf("Enhance API %s %s returned %d: %s", a.Method, a.Endpoint, a.Status, a.Body)
}

func apiStatus(err error) int {
	if ae, ok := err.(*APIError); ok {
		return ae.Status
	}
	return 0
}

// ---------------------------------------------------------------------------
// API types (field names follow the Enhance OpenAPI spec)
// ---------------------------------------------------------------------------

// ServerIP is one IP of a cluster server
type ServerIP struct {
	IP        string `json:"ip"`
	IsPrimary bool   `json:"isPrimary"`
}

// EnhanceServer is a server in the Enhance cluster
type EnhanceServer struct {
	ID               string                     `json:"id"`
	FriendlyName     string                     `json:"friendlyName"`
	Hostname         string                     `json:"hostname"`
	IsControlPanel   bool                       `json:"isControlPanel"`
	IsConfigured     bool                       `json:"isConfigured"`
	IsDecommissioned bool                       `json:"isDecommissioned"`
	IPs              []ServerIP                 `json:"ips"`
	Roles            map[string]json.RawMessage `json:"roles"`
}

// PrimaryIP returns the primary IPv4 of the server
func (s EnhanceServer) PrimaryIP() string {
	for _, ip := range s.IPs {
		if ip.IsPrimary {
			return ip.IP
		}
	}
	if len(s.IPs) > 0 {
		return s.IPs[0].IP
	}
	return ""
}

// EnabledRoles returns the roles that are enabled on the server (application, database, ...)
func (s EnhanceServer) EnabledRoles() []string {
	var roles []string
	for name, raw := range s.Roles {
		var state string
		if json.Unmarshal(raw, &state) == nil {
			if state == "enabled" {
				roles = append(roles, name)
			}
			continue
		}
		var obj map[string]interface{}
		if json.Unmarshal(raw, &obj) == nil {
			if st, ok := obj["state"].(string); ok && st == "enabled" {
				roles = append(roles, name)
			} else if len(obj) > 0 && st == "" {
				roles = append(roles, name)
			}
		}
	}
	return roles
}

// EnhanceOrg represents an organization
type EnhanceOrg struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// WebsiteDomain is a domain mapped to a website
type WebsiteDomain struct {
	ID           string `json:"id"`
	Domain       string `json:"domain"`
	DocumentRoot string `json:"documentRoot"`
	Kind         string `json:"kind"`
}

// EnhanceWebsite is a website as returned by the API
type EnhanceWebsite struct {
	ID            string          `json:"id"`
	Domain        WebsiteDomain   `json:"domain"`
	Aliases       []WebsiteDomain `json:"aliases"`
	Kind          string          `json:"kind"`
	Status        string          `json:"status"`
	AppServerID   string          `json:"appServerId"`
	DbServerID    string          `json:"dbServerId"`
	EmailServerID string          `json:"emailServerId"`
	UnixUser      string          `json:"unixUser"`
	PhpVersion    string          `json:"phpVersion"`
	DbServerIps   []ServerIP      `json:"dbServerIps"`
	ServerIps     []ServerIP      `json:"serverIps"`

	// Resolved on the node, not part of the API
	HomeDir string `json:"-"`
	DocRoot string `json:"-"`
}

// DBResult describes a database created on Enhance
type DBResult struct {
	SourceName string `json:"source_name"`
	Name       string `json:"name"`
	User       string `json:"user"`
	Password   string `json:"password"`
	Host       string `json:"host"`
	Tables     int    `json:"tables"`
	WPConfig   bool   `json:"wp_config_updated"`
}

// ImportResult summarises what was created on Enhance
type ImportResult struct {
	NodeHost  string                     `json:"node_host"`
	Websites  map[string]*EnhanceWebsite `json:"websites"`
	Databases []DBResult                 `json:"databases"`
	Emails    []string                   `json:"emails"`
	Cleanup   []string                   `json:"cleanup"`
	Warnings  []string                   `json:"warnings"`
}

// ---------------------------------------------------------------------------
// Servers / orgs / websites
// ---------------------------------------------------------------------------

// ListServers returns all servers in the cluster
func (e *Enhance) ListServers(ctx context.Context) ([]EnhanceServer, error) {
	if !e.connected {
		return nil, fmt.Errorf("not connected")
	}
	resp, err := e.apiRequest(ctx, "GET", "/servers", nil)
	if err != nil {
		return nil, err
	}
	var listing struct {
		Items json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(resp, &listing); err != nil {
		return nil, fmt.Errorf("failed to parse servers response: %w", err)
	}
	var servers []EnhanceServer
	if err := json.Unmarshal(listing.Items, &servers); err != nil {
		// grouped form: map[groupId][]server
		var grouped map[string][]EnhanceServer
		if err2 := json.Unmarshal(listing.Items, &grouped); err2 != nil {
			return nil, fmt.Errorf("failed to parse servers list: %w", err)
		}
		for _, list := range grouped {
			servers = append(servers, list...)
		}
	}
	return servers, nil
}

// GetServer returns one cluster server by ID
func (e *Enhance) GetServer(ctx context.Context, serverID string) (*EnhanceServer, error) {
	servers, err := e.ListServers(ctx)
	if err != nil {
		return nil, err
	}
	for i := range servers {
		if servers[i].ID == serverID {
			return &servers[i], nil
		}
	}
	return nil, fmt.Errorf("cluster server %s not found", serverID)
}

// ListAccounts returns all organizations (used by the servers page)
func (e *Enhance) ListAccounts(ctx context.Context) ([]common.Account, error) {
	if !e.connected {
		return nil, fmt.Errorf("not connected")
	}
	resp, err := e.apiRequest(ctx, "GET", "/orgs", nil)
	if err != nil {
		return nil, err
	}
	var orgsResponse struct {
		Items []EnhanceOrg `json:"items"`
	}
	if err := json.Unmarshal(resp, &orgsResponse); err != nil {
		return nil, fmt.Errorf("failed to parse orgs response: %w", err)
	}
	var accounts []common.Account
	for _, org := range orgsResponse.Items {
		accounts = append(accounts, common.Account{
			Username: org.Name,
			Metadata: map[string]string{"org_id": org.ID},
		})
	}
	return accounts, nil
}

func (e *Enhance) orgID() (string, error) {
	if e.config != nil && e.config.Metadata != nil && e.config.Metadata["enhance_org_id"] != "" {
		return e.config.Metadata["enhance_org_id"], nil
	}
	return "", fmt.Errorf("enhance_org_id not configured - please set it in server settings")
}

// GetWebsiteInfo returns full details of a website (includes unixUser and server IDs)
func (e *Enhance) GetWebsiteInfo(ctx context.Context, orgID string, websiteID string) (*EnhanceWebsite, error) {
	resp, err := e.apiRequest(ctx, "GET", fmt.Sprintf("/orgs/%s/websites/%s", orgID, websiteID), nil)
	if err != nil {
		return nil, err
	}
	var website EnhanceWebsite
	if err := json.Unmarshal(resp, &website); err != nil {
		return nil, fmt.Errorf("failed to parse website response: %w", err)
	}
	return &website, nil
}

// getWebsiteByDomain finds a website of the org by primary domain and returns its full details
func (e *Enhance) getWebsiteByDomain(ctx context.Context, orgID, domain string) (*EnhanceWebsite, error) {
	resp, err := e.apiRequest(ctx, "GET", fmt.Sprintf("/orgs/%s/websites?limit=1000", orgID), nil)
	if err != nil {
		return nil, err
	}
	var listing struct {
		Items []EnhanceWebsite `json:"items"`
	}
	if err := json.Unmarshal(resp, &listing); err != nil {
		return nil, err
	}
	for _, ws := range listing.Items {
		if strings.EqualFold(ws.Domain.Domain, domain) {
			return e.GetWebsiteInfo(ctx, orgID, ws.ID)
		}
	}
	return nil, fmt.Errorf("website not found: %s", domain)
}

// mapPHPVersion converts a DirectAdmin PHP version ("8.1") to Enhance's ("php81")
func (e *Enhance) mapPHPVersion(version string) string {
	if version == "" || version == "default" || version == "phpdefault" {
		return "php81"
	}
	version = strings.TrimPrefix(strings.ToLower(version), "php")
	version = strings.ReplaceAll(version, ".", "")
	valid := map[string]bool{"56": true, "70": true, "71": true, "72": true, "73": true, "74": true, "80": true, "81": true, "82": true, "83": true, "84": true, "85": true}
	if valid[version] {
		return "php" + version
	}
	return "php81"
}

// createWebsite creates a website on the selected cluster server and verifies placement.
func (e *Enhance) createWebsite(ctx context.Context, orgID string, domain *common.Domain) (*EnhanceWebsite, error) {
	target := e.targetClusterServerID
	if target == "" {
		return nil, fmt.Errorf("no target cluster server selected; refusing default placement")
	}

	// Re-run safety: reuse an existing website only when it sits on the selected server.
	if existing, err := e.getWebsiteByDomain(ctx, orgID, domain.Name); err == nil && existing != nil {
		if existing.AppServerID != target {
			return nil, fmt.Errorf("website %s already exists on a different server (appServerId=%s, selected=%s); move or delete it in Enhance first",
				domain.Name, existing.AppServerID, target)
		}
		e.logf("info", "Website %s already exists on the selected server (id=%s, unixUser=%s); reusing it",
			domain.Name, existing.ID, existing.UnixUser)
		return existing, nil
	}

	websiteReq := map[string]interface{}{
		"domain":      domain.Name,
		"appServerId": target,
		"dbServerId":  target,
		"phpVersion":  e.mapPHPVersion(domain.PHPVersion),
	}
	e.logf("info", "Creating website %s on cluster server %s (php=%s)", domain.Name, target, websiteReq["phpVersion"])

	resp, err := e.apiRequest(ctx, "POST", fmt.Sprintf("/orgs/%s/websites", orgID), websiteReq)
	if err != nil {
		return nil, err
	}
	var created struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(resp, &created)

	var website *EnhanceWebsite
	if created.ID != "" {
		website, err = e.GetWebsiteInfo(ctx, orgID, created.ID)
	}
	if website == nil || err != nil {
		website, err = e.getWebsiteByDomain(ctx, orgID, domain.Name)
	}
	if err != nil || website == nil {
		return nil, fmt.Errorf("website %s was created (id=%q) but could not be read back: %v", domain.Name, created.ID, err)
	}
	if website.AppServerID != target {
		return nil, fmt.Errorf("PLACEMENT MISMATCH: website %s (id=%s) landed on server %s instead of selected server %s; check it in Enhance before retrying",
			domain.Name, website.ID, website.AppServerID, target)
	}
	e.logf("info", "Website %s created on server %s (id=%s, unixUser=%s)", domain.Name, website.AppServerID, website.ID, website.UnixUser)
	return website, nil
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

func shq(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func (e *Enhance) nodeRun(ctx context.Context, cmd string) (string, error) {
	if e.node == nil {
		return "", fmt.Errorf("not connected to cluster node")
	}
	out, err := e.node.RunCommand(ctx, cmd)
	return strings.TrimSpace(out), err
}

// resolveWebsitePaths finds the website home and document root on the node.
func (e *Enhance) resolveWebsitePaths(ctx context.Context, ws *EnhanceWebsite) error {
	if ws.UnixUser == "" {
		return fmt.Errorf("website %s has no unixUser in the API response", ws.Domain.Domain)
	}
	home, err := e.nodeRun(ctx, fmt.Sprintf("getent passwd %s | cut -d: -f6", shq(ws.UnixUser)))
	if err != nil || home == "" {
		// Enhance keeps websites under /var/www/<website id>
		fallback := "/var/www/" + ws.ID
		if _, err2 := e.nodeRun(ctx, "test -d "+shq(fallback)); err2 != nil {
			return fmt.Errorf("cannot find home of unix user %s on node %s (getent failed: %v, %s missing)", ws.UnixUser, e.nodeHost, err, fallback)
		}
		home = fallback
	}
	ws.HomeDir = home
	docRoot := ws.Domain.DocumentRoot
	if docRoot == "" {
		docRoot = "public_html"
	}
	if !strings.HasPrefix(docRoot, "/") {
		docRoot = filepath.Join(home, docRoot)
	}
	if _, err := e.nodeRun(ctx, "test -d "+shq(docRoot)); err != nil {
		// give Enhance a moment: the directory is created asynchronously after the API call
		time.Sleep(3 * time.Second)
		if _, err := e.nodeRun(ctx, "test -d "+shq(docRoot)); err != nil {
			return fmt.Errorf("document root %s does not exist on node %s", docRoot, e.nodeHost)
		}
	}
	ws.DocRoot = docRoot
	e.logf("info", "Website %s on node %s: home=%s docroot=%s user=%s", ws.Domain.Domain, e.nodeHost, home, docRoot, ws.UnixUser)
	return nil
}

func randomPassword(n int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, n)
	for i := range b {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			b[i] = alphabet[i%len(alphabet)]
			continue
		}
		b[i] = alphabet[idx.Int64()]
	}
	return string(b)
}

// randomStrongPassword returns an alphanumeric password guaranteed to contain upper, lower,
// digit and symbol characters (Enhance rejects passwords that are "not complex enough").
func randomStrongPassword(n int) string {
	base := randomPassword(n - 4)
	const symbols = "!@#$%^&*-_=+"
	idx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(symbols))))
	idx2, _ := rand.Int(rand.Reader, big.NewInt(int64(len(symbols))))
	return "A" + base + "z9" + string(symbols[idx.Int64()]) + string(symbols[idx2.Int64()])
}

var dbNameSanitizer = regexp.MustCompile(`[^0-9a-z_]`)

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

// ImportAccount imports everything exported from the source into Enhance.
// Websites, files, databases and permissions are fatal on failure; emails, cron
// jobs and SSL are recorded as warnings.
func (e *Enhance) ImportAccount(ctx context.Context, data *common.ExportData, progress chan<- common.MigrationProgress) (*ImportResult, error) {
	if !e.connected {
		return nil, fmt.Errorf("not connected")
	}
	if e.node == nil {
		return nil, fmt.Errorf("not connected to the cluster node; cannot import files")
	}
	orgID, err := e.orgID()
	if err != nil {
		return nil, err
	}

	totalSteps := 10
	step := 0
	sendProgress := func(name string) {
		e.logf("info", "%s", name) // written synchronously so warnings of the step never precede its heading
		if progress != nil {
			progress <- common.MigrationProgress{Status: "running", CurrentStep: name, TotalSteps: totalSteps, CompletedSteps: step, Logged: true}
		}
		step++
	}

	result := &ImportResult{NodeHost: e.nodeHost, Websites: e.websites}

	// 1. Websites
	sendProgress("Creating websites")
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("migration cancelled: %w", err)
	}
	if len(data.Domains) == 0 {
		return nil, fmt.Errorf("export contains no domains")
	}
	for i := range data.Domains {
		d := &data.Domains[i]
		ws, err := e.createWebsite(ctx, orgID, d)
		if err != nil {
			return nil, fmt.Errorf("failed to create website %s: %w", d.Name, err)
		}
		if err := e.resolveWebsitePaths(ctx, ws); err != nil {
			return nil, err
		}
		e.websites[strings.ToLower(d.Name)] = ws
	}

	// 2. Files
	sendProgress("Uploading files")
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("migration cancelled: %w", err)
	}
	if data.FilesPath == "" {
		return nil, fmt.Errorf("export has no files path")
	}
	for _, d := range data.Domains {
		ws := e.websites[strings.ToLower(d.Name)]
		localDocRoot := filepath.Join(data.FilesPath, "domains", d.Name, "public_html")
		if _, err := os.Stat(localDocRoot); err != nil {
			return nil, fmt.Errorf("exported files for %s not found at %s", d.Name, localDocRoot)
		}
		if err := e.uploadFiles(ctx, ws, localDocRoot, progress); err != nil {
			return nil, fmt.Errorf("failed to upload files for %s: %w", d.Name, err)
		}
	}

	// 3. Databases
	sendProgress("Importing databases")
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("migration cancelled: %w", err)
	}
	if len(data.Databases) > 0 {
		main := e.websites[strings.ToLower(data.Account.Domain)]
		if main == nil {
			main = e.websites[strings.ToLower(data.Domains[0].Name)]
		}
		dumpDir := filepath.Join(filepath.Dir(data.FilesPath), "databases")
		for _, db := range data.Databases {
			res, err := e.importDatabase(ctx, orgID, main, db, dumpDir, data.Account.Username)
			if err != nil {
				return nil, fmt.Errorf("failed to import database %s: %w", db.Name, err)
			}
			result.Databases = append(result.Databases, *res)
		}
		if err := e.updateWPConfigs(ctx, result.Databases); err != nil {
			return nil, err
		}
	} else {
		e.logf("info", "No databases in export; skipping database import")
	}

	// 4. WordPress registration: app discovery + web server rewrite (warnings only)
	sendProgress("Registering WordPress")
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("migration cancelled: %w", err)
	}
	for _, ws := range e.websites {
		if err := e.registerWordPress(ctx, orgID, ws); err != nil {
			e.warnf("WordPress registration for %s incomplete: %v", ws.Domain.Domain, err)
		}
	}

	// 5. WordPress cleanup: debug off, leftover backups/archives removed, migration backup removed (warnings only)
	sendProgress("WordPress cleanup")
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("migration cancelled: %w", err)
	}
	for _, ws := range e.websites {
		summary, err := e.cleanupWordPress(ctx, ws)
		if err != nil {
			e.warnf("WordPress cleanup for %s incomplete: %v", ws.Domain.Domain, err)
		}
		if summary != "" {
			result.Cleanup = append(result.Cleanup, summary)
		}
	}

	// 6. PHP: always-on extensions + ionCube loader (warnings only)
	sendProgress("Configuring PHP")
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("migration cancelled: %w", err)
	}
	for _, ws := range e.websites {
		e.configurePHP(ctx, ws)
	}

	// 6. Emails (warnings only)
	sendProgress("Importing email accounts")
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("migration cancelled: %w", err)
	}
	for _, em := range data.Emails {
		if addr, err := e.importEmail(ctx, orgID, em); err != nil {
			e.warnf("Email %s not created: %v", em.Email, err)
		} else {
			result.Emails = append(result.Emails, addr)
		}
	}
	if len(data.Emails) > 0 {
		e.warnf("%d mailbox(es) created with new random passwords (see log); mailbox contents were not migrated", len(result.Emails))
	}

	// 7. Cron jobs (warnings only)
	sendProgress("Importing cron jobs")
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("migration cancelled: %w", err)
	}
	if len(data.CronJobs) > 0 {
		main := e.websites[strings.ToLower(data.Account.Domain)]
		if main == nil {
			main = e.websites[strings.ToLower(data.Domains[0].Name)]
		}
		if err := e.importCronJobs(ctx, orgID, main, data); err != nil {
			e.warnf("Cron jobs not imported: %v", err)
		}
	}

	// 8. SSL (warnings only; Enhance issues Let's Encrypt once DNS points here)
	sendProgress("Setting up SSL certificates")
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("migration cancelled: %w", err)
	}
	for _, d := range data.Domains {
		if d.SSL == nil {
			continue
		}
		ws := e.websites[strings.ToLower(d.Name)]
		if err := e.setupSSL(ctx, ws, d.SSL); err != nil {
			e.warnf("SSL certificate for %s not installed (Enhance will issue Let's Encrypt after DNS change): %v", d.Name, err)
		}
	}

	// 9. Permissions (fatal)
	sendProgress("Fixing file permissions")
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("migration cancelled: %w", err)
	}
	for _, ws := range e.websites {
		if err := e.fixPermissions(ctx, ws); err != nil {
			return nil, err
		}
	}

	result.Warnings = e.warnings
	return result, nil
}

// uploadFiles uploads a document root to the website's document root on the node and verifies it.
func (e *Enhance) uploadFiles(ctx context.Context, ws *EnhanceWebsite, localDocRoot string, progress chan<- common.MigrationProgress) error {
	localFiles := 0
	filepath.Walk(localDocRoot, func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			localFiles++
		}
		return nil
	})
	if progress != nil {
		progress <- common.MigrationProgress{Status: "running", CurrentStep: fmt.Sprintf("Uploading files to %s", ws.Domain.Domain)}
	}
	e.logf("info", "Uploading %d files for %s to %s:%s", localFiles, ws.Domain.Domain, e.nodeHost, ws.DocRoot)

	// Remove Enhance's placeholder index.html when the site brings its own entry point
	if _, err := os.Stat(filepath.Join(localDocRoot, "index.html")); os.IsNotExist(err) {
		e.nodeRun(ctx, fmt.Sprintf("[ -f %s/index.html ] && rm -f %s/index.html || true", shq(ws.DocRoot), shq(ws.DocRoot)))
	}

	start := time.Now()
	if err := e.node.RsyncUploadWithKey(ctx, localDocRoot, ws.DocRoot); err != nil {
		return err
	}
	// rsync -a preserves the source uid; hand the files to the website user right away
	if out, err := e.nodeRun(ctx, fmt.Sprintf("chown -R %s:%s %s", shq(ws.UnixUser), shq(ws.UnixUser), shq(ws.DocRoot))); err != nil {
		return fmt.Errorf("chown after upload failed: %v %s", err, out)
	}

	out, err := e.nodeRun(ctx, fmt.Sprintf("find %s -type f 2>/dev/null | wc -l; du -sh %s 2>/dev/null | cut -f1", shq(ws.DocRoot), shq(ws.DocRoot)))
	if err != nil {
		return fmt.Errorf("could not verify uploaded files: %w", err)
	}
	parts := strings.Fields(out)
	remoteFiles := 0
	size := ""
	if len(parts) > 0 {
		remoteFiles, _ = strconv.Atoi(parts[0])
	}
	if len(parts) > 1 {
		size = parts[1]
	}
	e.logf("info", "Upload for %s done in %s: %d files on node (%s), %d files locally", ws.Domain.Domain, time.Since(start).Round(time.Second), remoteFiles, size, localFiles)
	if localFiles > 0 && remoteFiles == 0 {
		return fmt.Errorf("no files found in %s on node after upload", ws.DocRoot)
	}
	if remoteFiles < localFiles*9/10 {
		return fmt.Errorf("only %d of %d files arrived in %s on node", remoteFiles, localFiles, ws.DocRoot)
	}
	return nil
}

// importDatabase creates the database and user via the API and loads the dump on the node.
func (e *Enhance) importDatabase(ctx context.Context, orgID string, ws *EnhanceWebsite, db common.Database, dumpDir, sourceUser string) (*DBResult, error) {
	base := strings.ToLower(db.Name)
	if sourceUser != "" {
		base = strings.TrimPrefix(base, strings.ToLower(sourceUser)+"_")
	}
	base = dbNameSanitizer.ReplaceAllString(base, "_")
	if base == "" {
		base = "db"
	}

	// Create DB (409 = already exists, reuse)
	dbEndpoint := fmt.Sprintf("/orgs/%s/websites/%s/mysql-dbs", orgID, ws.ID)
	if _, err := e.apiRequest(ctx, "POST", dbEndpoint, map[string]interface{}{"name": base}); err != nil {
		if apiStatus(err) != 409 {
			return nil, fmt.Errorf("create database: %w", err)
		}
		e.logf("info", "Database %s already exists for %s; reusing", base, ws.Domain.Domain)
	}
	actualDB, err := e.findMySQLName(ctx, dbEndpoint, base, ws.UnixUser)
	if err != nil {
		return nil, err
	}

	// Create user
	userBase := base
	if len(userBase) > 16 {
		userBase = userBase[:16]
	}
	password := randomPassword(24)
	userEndpoint := fmt.Sprintf("/orgs/%s/websites/%s/mysql-users", orgID, ws.ID)
	if _, err := e.apiRequest(ctx, "POST", userEndpoint, map[string]interface{}{"username": userBase, "password": password}); err != nil {
		if apiStatus(err) != 409 {
			return nil, fmt.Errorf("create database user: %w", err)
		}
		// exists: reset the password so we know it
		actualUser, ferr := e.findMySQLName(ctx, userEndpoint, userBase, ws.UnixUser)
		if ferr != nil {
			return nil, ferr
		}
		if _, err := e.apiRequest(ctx, "PUT", fmt.Sprintf("%s/%s", userEndpoint, actualUser), map[string]interface{}{"password": password}); err != nil {
			return nil, fmt.Errorf("database user %s exists and password reset failed: %w", actualUser, err)
		}
	}
	actualUser, err := e.findMySQLName(ctx, userEndpoint, userBase, ws.UnixUser)
	if err != nil {
		return nil, err
	}

	// Grant privileges
	privEndpoint := fmt.Sprintf("%s/%s/privileges", userEndpoint, actualUser)
	granted := false
	var lastErr error
	// Enhance's MySQLUserGrants enum: all, alter, alterRoutine, create, createRoutine, createTemporaryTables,
	// createView, delete, drop, event, execute, index, insert, lockTables, references, select, showView, trigger, update
	for _, grants := range [][]string{{"all"}, {"select", "insert", "update", "delete", "create", "drop", "index", "alter", "createTemporaryTables", "lockTables", "execute", "createView", "showView", "createRoutine", "alterRoutine", "event", "trigger", "references"}} {
		if _, err := e.apiRequest(ctx, "PUT", privEndpoint, map[string]interface{}{"dbName": actualDB, "grants": grants}); err != nil {
			lastErr = err
			continue
		}
		granted = true
		break
	}
	if !granted {
		return nil, fmt.Errorf("grant privileges on %s to %s: %w", actualDB, actualUser, lastErr)
	}
	e.logf("info", "Database %s and user %s created for %s", actualDB, actualUser, ws.Domain.Domain)

	// Locate dump
	dumpFile := ""
	for _, cand := range []string{db.Name + ".sql.gz", db.Name + ".sql"} {
		if _, err := os.Stat(filepath.Join(dumpDir, cand)); err == nil {
			dumpFile = filepath.Join(dumpDir, cand)
			break
		}
	}
	res := &DBResult{SourceName: db.Name, Name: actualDB, User: actualUser, Password: password}
	if dumpFile == "" {
		return nil, fmt.Errorf("dump for %s not found in %s", db.Name, dumpDir)
	}

	// Upload dump to the node
	remoteDump := fmt.Sprintf("/tmp/migration_%s_%d%s", base, time.Now().Unix(), strings.TrimPrefix(filepath.Ext(dumpFile), ""))
	if strings.HasSuffix(dumpFile, ".sql.gz") {
		remoteDump = fmt.Sprintf("/tmp/migration_%s_%d.sql.gz", base, time.Now().Unix())
	}
	if err := e.node.Upload(ctx, dumpFile, remoteDump); err != nil {
		return nil, fmt.Errorf("upload dump to node: %w", err)
	}
	e.tmpPaths = append(e.tmpPaths, remoteDump)

	reader := "cat " + shq(remoteDump)
	if strings.HasSuffix(remoteDump, ".gz") {
		reader = "zcat " + shq(remoteDump)
	}
	hosts := []string{"", "127.0.0.1"}
	for _, ip := range ws.DbServerIps {
		hosts = append(hosts, ip.IP)
	}
	imported := false
	var importErr error
	for _, host := range hosts {
		hostFlag := ""
		if host != "" {
			hostFlag = " -h " + shq(host)
		}
		cmd := fmt.Sprintf("set -o pipefail 2>/dev/null; %s | mysql%s -u %s -p%s %s 2>&1",
			reader, hostFlag, shq(actualUser), shq(password), shq(actualDB))
		out, err := e.nodeRun(ctx, cmd)
		if err == nil {
			imported = true
			if host == "" {
				res.Host = "localhost"
			} else {
				res.Host = host
			}
			break
		}
		importErr = fmt.Errorf("%v", out)
		if !strings.Contains(out, "Can't connect") && !strings.Contains(out, "Access denied") {
			break // real SQL error: no point trying other hosts
		}
	}
	if !imported {
		return nil, fmt.Errorf("mysql import of %s failed on node: %v", actualDB, importErr)
	}

	// Verify with the same host that worked for the import; MariaDB's client prints a
	// deprecation notice on stderr, so drop stderr and read only the last line.
	verifyHost := ""
	if res.Host != "" && res.Host != "localhost" {
		verifyHost = " -h " + shq(res.Host)
	}
	countOut, err := e.nodeRun(ctx, fmt.Sprintf("mysql%s -u %s -p%s -N -e %s 2>/dev/null", verifyHost, shq(actualUser), shq(password),
		shq(fmt.Sprintf("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='%s'", actualDB))))
	if err != nil {
		return nil, fmt.Errorf("could not verify database %s after import: %v %s", actualDB, err, countOut)
	}
	res.Tables = lastInt(countOut)
	if res.Tables == 0 {
		return nil, fmt.Errorf("database %s has no tables after import (verification output: %q)", actualDB, countOut)
	}
	e.nodeRun(ctx, "rm -f "+shq(remoteDump))
	e.logf("info", "Database %s imported on node: %d tables (user %s, host %s)", actualDB, res.Tables, actualUser, res.Host)
	return res, nil
}

// lastInt returns the integer on the last non-empty line of a command output (0 if none)
func lastInt(out string) int {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if n, err := strconv.Atoi(strings.TrimSpace(lines[i])); err == nil {
			return n
		}
	}
	return 0
}

// findMySQLName lists mysql-dbs or mysql-users and returns the actual (possibly prefixed) name
func (e *Enhance) findMySQLName(ctx context.Context, listEndpoint, base, unixUser string) (string, error) {
	resp, err := e.apiRequest(ctx, "GET", listEndpoint, nil)
	if err != nil {
		return "", fmt.Errorf("list %s: %w", listEndpoint, err)
	}
	var listing struct {
		Items []struct {
			Name     string `json:"name"`
			Username string `json:"username"`
		} `json:"items"`
	}
	if err := json.Unmarshal(resp, &listing); err != nil {
		return "", fmt.Errorf("parse %s: %w", listEndpoint, err)
	}
	var names []string
	for _, it := range listing.Items {
		if it.Name != "" {
			names = append(names, it.Name)
		} else {
			names = append(names, it.Username)
		}
	}
	for _, cand := range []string{base, unixUser + "_" + base} {
		for _, n := range names {
			if n == cand {
				return n, nil
			}
		}
	}
	for _, n := range names {
		if strings.HasSuffix(n, "_"+base) {
			return n, nil
		}
	}
	return "", fmt.Errorf("%s not found in Enhance listing after creation (have: %s)", base, strings.Join(names, ", "))
}

// updateWPConfigs rewrites DB credentials in wp-config.php of every migrated website
func (e *Enhance) updateWPConfigs(ctx context.Context, dbs []DBResult) error {
	if len(dbs) == 0 {
		return nil
	}
	dbHost := e.detectDBHost(ctx)
	for _, ws := range e.websites {
		wpConfig := ws.DocRoot + "/wp-config.php"
		if _, err := e.nodeRun(ctx, "test -f "+shq(wpConfig)); err != nil {
			continue
		}
		current, _ := e.nodeRun(ctx, fmt.Sprintf(`grep -oE "define\( *['\"]DB_NAME['\"] *, *['\"][^'\"]*['\"]" %s | head -1 | sed -E "s/.*, *['\"]([^'\"]*)['\"]/\1/"`, shq(wpConfig)))
		var match *DBResult
		for i := range dbs {
			if dbs[i].SourceName == current {
				match = &dbs[i]
			}
		}
		if match == nil {
			if len(dbs) == 1 {
				match = &dbs[0]
				e.warnf("wp-config.php of %s references DB %q which was not in the export; pointing it to %s", ws.Domain.Domain, current, match.Name)
			} else {
				e.warnf("wp-config.php of %s references DB %q; could not decide which imported database to use, update it manually", ws.Domain.Domain, current)
				continue
			}
		}
		e.nodeRun(ctx, fmt.Sprintf("cp -a %s %s.pre-migration", shq(wpConfig), shq(wpConfig)))
		for key, val := range map[string]string{"DB_NAME": match.Name, "DB_USER": match.User, "DB_PASSWORD": match.Password, "DB_HOST": dbHost} {
			cmd := fmt.Sprintf(`sed -i -E "s|define\( *['\"]%s['\"] *, *['\"][^'\"]*['\"] *\)|define('%s', '%s')|" %s`, key, key, val, shq(wpConfig))
			if out, err := e.nodeRun(ctx, cmd); err != nil {
				return fmt.Errorf("update %s in wp-config.php of %s: %v %s", key, ws.Domain.Domain, err, out)
			}
		}
		check, _ := e.nodeRun(ctx, fmt.Sprintf("grep -c %s %s", shq("'"+match.Name+"'"), shq(wpConfig)))
		if strings.TrimSpace(check) == "0" {
			return fmt.Errorf("wp-config.php of %s still does not reference database %s after update", ws.Domain.Domain, match.Name)
		}
		match.WPConfig = true
		match.Host = dbHost
		e.nodeRun(ctx, fmt.Sprintf("chown %s:%s %s.pre-migration && chmod 600 %s.pre-migration", shq(ws.UnixUser), shq(ws.UnixUser), shq(wpConfig), shq(wpConfig)))
		e.logf("info", "wp-config.php of %s updated: DB_NAME=%s DB_USER=%s DB_HOST=%s (backup: wp-config.php.pre-migration)", ws.Domain.Domain, match.Name, match.User, dbHost)
	}
	for _, db := range dbs {
		if !db.WPConfig {
			e.warnf("Database %s imported but no wp-config.php was updated; new credentials: user=%s password=%s host=%s", db.Name, db.User, db.Password, dbHost)
		}
	}
	return nil
}

// detectDBHost looks at other websites on the node to learn the DB_HOST Enhance uses
func (e *Enhance) detectDBHost(ctx context.Context) string {
	exclude := ""
	for _, ws := range e.websites {
		exclude += " -not -path " + shq(ws.DocRoot+"/*")
	}
	cmd := fmt.Sprintf(`find /var/www -maxdepth 3 -name wp-config.php%s 2>/dev/null | head -20 | xargs -r grep -hoE "define\( *['\"]DB_HOST['\"] *, *['\"][^'\"]*['\"]" 2>/dev/null | sed -E "s/.*, *['\"]([^'\"]*)['\"]/\1/" | sort | uniq -c | sort -rn | head -1 | awk '{print $2}'`, exclude)
	out, err := e.nodeRun(ctx, cmd)
	if err == nil && out != "" {
		e.logf("info", "Using DB_HOST=%s (learned from existing websites on the node)", out)
		return out
	}
	e.logf("info", "Using DB_HOST=localhost (no other WordPress sites on the node to learn from)")
	return "localhost"
}

// registerWordPress makes Enhance aware of a migrated WordPress install and adds the
// web server rewrite WordPress permalinks need on Nginx (harmless on LiteSpeed/Apache).
func (e *Enhance) registerWordPress(ctx context.Context, orgID string, ws *EnhanceWebsite) error {
	if _, err := e.nodeRun(ctx, "test -f "+shq(ws.DocRoot+"/wp-config.php")); err != nil {
		e.logf("info", "%s: no wp-config.php, skipping WordPress registration", ws.Domain.Domain)
		return nil
	}

	kind := "unknown"
	if resp, err := e.apiRequest(ctx, "GET", fmt.Sprintf("/v2/websites/%s/webserver_kind", ws.ID), nil); err == nil {
		kind = strings.Trim(strings.TrimSpace(string(resp)), `"`)
	}

	// Discovery: orchd scans the website and records the WP installation (db name, prefix, path)
	var problems []string
	if resp, err := e.apiRequest(ctx, "GET", fmt.Sprintf("/orgs/%s/websites/%s/apps/wordpress", orgID, ws.ID), nil); err != nil {
		problems = append(problems, fmt.Sprintf("discovery: %v", err))
	} else {
		var installs []struct {
			DbName      string `json:"dbName"`
			DbUser      string `json:"dbUser"`
			TablePrefix string `json:"tablePrefix"`
			Path        string `json:"path"`
		}
		_ = json.Unmarshal(resp, &installs)
		if len(installs) == 0 {
			problems = append(problems, "discovery found no WordPress installation")
		} else {
			e.logf("info", "%s: WordPress discovered by Enhance (db=%s, prefix=%s, path=%q, web server=%s)",
				ws.Domain.Domain, installs[0].DbName, installs[0].TablePrefix, installs[0].Path, kind)
		}
	}

	// Rewrite: route requests for non-existent files to /index.php (WordPress permalinks)
	rewrite := map[string]interface{}{"path": "/", "destinationFile": "/index.php"}
	if _, err := e.apiRequest(ctx, "PUT", fmt.Sprintf("/v2/domains/%s/webserver_rewrites", ws.Domain.ID), rewrite); err != nil {
		problems = append(problems, fmt.Sprintf("rewrite: %v", err))
	} else {
		verified := ""
		if resp, err := e.apiRequest(ctx, "GET", fmt.Sprintf("/v2/domains/%s/webserver_rewrites", ws.Domain.ID), nil); err == nil {
			verified = strings.TrimSpace(string(resp))
		}
		e.logf("info", "%s: web server rewrite / -> /index.php set (current rewrites: %s)", ws.Domain.Domain, verified)
	}
	for _, alias := range ws.Aliases {
		if alias.ID == "" {
			continue
		}
		if _, err := e.apiRequest(ctx, "PUT", fmt.Sprintf("/v2/domains/%s/webserver_rewrites", alias.ID), rewrite); err != nil {
			problems = append(problems, fmt.Sprintf("rewrite for alias %s: %v", alias.Domain, err))
		}
	}

	if len(problems) > 0 {
		return fmt.Errorf("%s", strings.Join(problems, "; "))
	}
	return nil
}

// cleanupWordPress turns debug off, removes leftover backup archives and the wp-config backup,
// and returns a human readable summary of what existed and what was removed.
func (e *Enhance) cleanupWordPress(ctx context.Context, ws *EnhanceWebsite) (string, error) {
	wpConfig := ws.DocRoot + "/wp-config.php"
	if _, err := e.nodeRun(ctx, "test -f "+shq(wpConfig)); err != nil {
		return "", nil
	}
	var report []string

	// 1. Debug flags
	before, _ := e.nodeRun(ctx, fmt.Sprintf(`grep -oE "define\( *['\"](WP_DEBUG|WP_DEBUG_LOG|WP_DEBUG_DISPLAY|SCRIPT_DEBUG)['\"] *, *[^)]*\)" %s`, shq(wpConfig)))
	for _, flag := range []string{"WP_DEBUG", "WP_DEBUG_LOG", "WP_DEBUG_DISPLAY", "SCRIPT_DEBUG"} {
		cmd := fmt.Sprintf(`sed -i -E "s|define\( *['\"]%s['\"] *, *[^)]*\)|define('%s', false)|" %s`, flag, flag, shq(wpConfig))
		if out, err := e.nodeRun(ctx, cmd); err != nil {
			return strings.Join(report, "; "), fmt.Errorf("could not update %s: %v %s", flag, err, out)
		}
	}
	after, _ := e.nodeRun(ctx, fmt.Sprintf(`grep -oE "define\( *['\"](WP_DEBUG|WP_DEBUG_LOG|WP_DEBUG_DISPLAY|SCRIPT_DEBUG)['\"] *, *[^)]*\)" %s`, shq(wpConfig)))
	debugWasOn := strings.Contains(strings.ToLower(before), "true")
	if debugWasOn {
		report = append(report, fmt.Sprintf("debug flags were ON (%s) → now off", strings.ReplaceAll(strings.TrimSpace(before), "\n", " ")))
	} else if strings.TrimSpace(after) != "" {
		report = append(report, "debug flags already off")
	}
	e.logf("info", "%s: debug flags before: %q; after: %q", ws.Domain.Domain, strings.ReplaceAll(strings.TrimSpace(before), "\n", " "), strings.ReplaceAll(strings.TrimSpace(after), "\n", " "))

	// 2. Leftover files: debug logs, All-in-One .wpress exports, archives and dumps outside uploads,
	//    plus known backup-plugin folders even when they live under uploads.
	find := fmt.Sprintf(`cd %s && find . -type f \( -name 'debug.log' -o -iname '*.wpress' -o -path '*/ai1wm-backups/*' -o -path '*/updraft/*' -o -path '*/backups-dup-lite/*' -o -path '*/backups-dup-pro/*' -o -path '*/backupbuddy_backups/*' -o -path '*/uploads/backwpup-*' -o -path '*/uploads/wp-staging/*' -o \( \( -iname '*.zip' -o -iname '*.tar.gz' -o -iname '*.tgz' -o -iname '*.sql' -o -iname '*.sql.gz' -o -iname '*.tar' \) -not -path './wp-content/uploads/*' \) \) -not -path './wp-content/plugins/*' -not -path './wp-content/mu-plugins/*' -not -path './wp-content/themes/*' -not -path './wp-admin/*' -not -path './wp-includes/*' -not -name '.htaccess' -not -name 'index.html' -not -name 'index.php' -not -name 'robots.txt' -not -name 'web.config' -printf '%%s\t%%p\n' 2>/dev/null | sort -k2`, shq(ws.DocRoot))
	listing, err := e.nodeRun(ctx, find)
	if err != nil && listing == "" {
		return strings.Join(report, "; "), fmt.Errorf("listing leftover files failed: %v", err)
	}
	var paths []string
	var totalBytes int64
	var lines []string
	for _, line := range strings.Split(strings.TrimSpace(listing), "\n") {
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 || parts[1] == "" {
			continue
		}
		size, _ := strconv.ParseInt(parts[0], 10, 64)
		totalBytes += size
		paths = append(paths, parts[1])
		lines = append(lines, fmt.Sprintf("%s (%.1f MB)", strings.TrimPrefix(parts[1], "./"), float64(size)/1024/1024))
	}
	if len(paths) > 0 {
		var quoted []string
		for _, p := range paths {
			quoted = append(quoted, shq(p))
		}
		// delete in batches to keep the command line short
		for i := 0; i < len(quoted); i += 200 {
			end := i + 200
			if end > len(quoted) {
				end = len(quoted)
			}
			if out, err := e.nodeRun(ctx, fmt.Sprintf("cd %s && rm -f %s", shq(ws.DocRoot), strings.Join(quoted[i:end], " "))); err != nil {
				return strings.Join(report, "; "), fmt.Errorf("deleting leftover files failed: %v %s", err, out)
			}
		}
		shown := lines
		if len(shown) > 40 {
			shown = append(shown[:40], fmt.Sprintf("... and %d more", len(lines)-40))
		}
		report = append(report, fmt.Sprintf("deleted %d leftover file(s), %.1f MB: %s", len(paths), float64(totalBytes)/1024/1024, strings.Join(shown, ", ")))
		e.logf("info", "%s: deleted %d leftover file(s) (%.1f MB): %s", ws.Domain.Domain, len(paths), float64(totalBytes)/1024/1024, strings.Join(shown, ", "))
	} else {
		report = append(report, "no leftover debug logs, .wpress or archive files found")
		e.logf("info", "%s: no leftover debug logs, .wpress or archive files found", ws.Domain.Domain)
	}

	// Archives inside uploads are kept (they may be downloadable products); report them.
	kept, _ := e.nodeRun(ctx, fmt.Sprintf(`cd %s && find ./wp-content/uploads -type f \( -iname '*.zip' -o -iname '*.tar.gz' -o -iname '*.tgz' -o -iname '*.sql' -o -iname '*.sql.gz' \) -printf '%%s\n' 2>/dev/null | awk '{n++; s+=$1} END {printf "%%d %%d", n, s}'`, shq(ws.DocRoot)))
	if f := strings.Fields(kept); len(f) == 2 && f[0] != "0" {
		keptBytes, _ := strconv.ParseInt(f[1], 10, 64)
		msg := fmt.Sprintf("kept %s archive(s) inside wp-content/uploads (%.1f MB) because they may be site content; review manually", f[0], float64(keptBytes)/1024/1024)
		report = append(report, msg)
		e.warnf("%s: %s", ws.Domain.Domain, msg)
	}

	// 3. Our own wp-config backup is a migration artifact: remove it now that the site is wired up.
	if _, err := e.nodeRun(ctx, "rm -f "+shq(wpConfig+".pre-migration")); err == nil {
		report = append(report, "removed wp-config.php.pre-migration")
	}

	summary := fmt.Sprintf("%s: %s", ws.Domain.Domain, strings.Join(report, "; "))
	e.logf("info", "WordPress cleanup summary for %s", summary)
	return summary, nil
}

// importEmail creates a mailbox with a new random password
func (e *Enhance) importEmail(ctx context.Context, orgID string, em common.EmailAccount) (string, error) {
	parts := strings.SplitN(em.Email, "@", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid address")
	}
	ws := e.websites[strings.ToLower(parts[1])]
	if ws == nil {
		return "", fmt.Errorf("no migrated website for domain %s", parts[1])
	}
	password := randomStrongPassword(20)
	req := map[string]interface{}{"username": parts[0], "mailboxPassword": password}
	if em.Quota > 0 {
		req["quota"] = em.Quota / (1024 * 1024)
	}
	endpoint := fmt.Sprintf("/orgs/%s/websites/%s/domains/%s/emails", orgID, ws.ID, ws.Domain.ID)
	if _, err := e.apiRequest(ctx, "POST", endpoint, req); err != nil {
		if apiStatus(err) == 409 {
			e.logf("info", "Mailbox %s already exists; left unchanged", em.Email)
			return em.Email, nil
		}
		return "", err
	}
	e.logf("info", "Mailbox %s created with password %s", em.Email, password)
	return em.Email, nil
}

// importCronJobs appends the source cron jobs to the website crontab, rewriting paths
func (e *Enhance) importCronJobs(ctx context.Context, orgID string, ws *EnhanceWebsite, data *common.ExportData) error {
	endpoint := fmt.Sprintf("/orgs/%s/websites/%s/crontab", orgID, ws.ID)
	existing := 0
	if resp, err := e.apiRequest(ctx, "GET", endpoint, nil); err == nil && len(resp) > 0 {
		var listing struct {
			Items []json.RawMessage `json:"items"`
		}
		if json.Unmarshal(resp, &listing) == nil {
			existing = len(listing.Items)
		}
	}
	var items []map[string]interface{}
	for i, cj := range data.CronJobs {
		cmd := cj.Command
		for _, d := range data.Domains {
			if w := e.websites[strings.ToLower(d.Name)]; w != nil && d.DocumentRoot != "" {
				cmd = strings.ReplaceAll(cmd, d.DocumentRoot, w.DocRoot)
			}
		}
		cmd = strings.ReplaceAll(cmd, "/home/"+data.Account.Username+"/domains/", "/var/www/")
		cmd = strings.ReplaceAll(cmd, "/usr/local/bin/php", "php")
		cmd = strings.ReplaceAll(cmd, "/usr/bin/php", "php")
		expr := fmt.Sprintf("%s %s %s %s %s %s", cj.Minute, cj.Hour, cj.Day, cj.Month, cj.Weekday, cmd)
		items = append(items, map[string]interface{}{"cronCmd": map[string]interface{}{"lineNumber": existing + i + 1, "expr": expr}})
	}
	if _, err := e.apiRequest(ctx, "PATCH", endpoint, map[string]interface{}{"items": items}); err != nil {
		return err
	}
	e.logf("info", "%d cron job(s) added to %s", len(items), ws.Domain.Domain)
	return nil
}

// setupSSL uploads the source certificate for the website domain
func (e *Enhance) setupSSL(ctx context.Context, ws *EnhanceWebsite, cert *common.SSLCert) error {
	if !cert.ExpiresAt.IsZero() && cert.ExpiresAt.Before(time.Now()) {
		return fmt.Errorf("source certificate expired on %s", cert.ExpiresAt.Format("2006-01-02"))
	}
	fullCert := strings.TrimSpace(cert.Certificate)
	if strings.TrimSpace(cert.CABundle) != "" {
		fullCert += "\n" + strings.TrimSpace(cert.CABundle)
	}
	body := map[string]interface{}{"cert": fullCert, "key": strings.TrimSpace(cert.PrivateKey), "pkey": strings.TrimSpace(cert.PrivateKey)}
	if _, err := e.apiRequest(ctx, "POST", fmt.Sprintf("/v2/domains/%s/ssl", ws.Domain.ID), body); err != nil {
		return err
	}
	e.logf("info", "SSL certificate installed for %s", ws.Domain.Domain)
	return nil
}

// fixPermissions sets ownership and modes on the website document root
func (e *Enhance) fixPermissions(ctx context.Context, ws *EnhanceWebsite) error {
	if ws.UnixUser == "" || ws.DocRoot == "" {
		return fmt.Errorf("cannot fix permissions for %s: unknown unix user or docroot", ws.Domain.Domain)
	}
	group, err := e.nodeRun(ctx, fmt.Sprintf("id -gn %s", shq(ws.UnixUser)))
	if err != nil || group == "" {
		group = ws.UnixUser
	}
	steps := []string{
		fmt.Sprintf("chown -R %s:%s %s", shq(ws.UnixUser), shq(group), shq(ws.DocRoot)),
		fmt.Sprintf("find %s -type d -exec chmod 755 {} +", shq(ws.DocRoot)),
		fmt.Sprintf("find %s -type f -exec chmod 644 {} +", shq(ws.DocRoot)),
		fmt.Sprintf("[ -f %s/wp-config.php ] && chmod 600 %s/wp-config.php || true", shq(ws.DocRoot), shq(ws.DocRoot)),
	}
	for _, cmd := range steps {
		if out, err := e.nodeRun(ctx, cmd); err != nil {
			return fmt.Errorf("permission fix failed for %s (%s): %v %s", ws.Domain.Domain, cmd, err, out)
		}
	}
	owner, _ := e.nodeRun(ctx, fmt.Sprintf("stat -c '%%U:%%G %%a' %s", shq(ws.DocRoot)))
	e.logf("info", "Permissions fixed for %s: %s is %s, dirs 755, files 644", ws.Domain.Domain, ws.DocRoot, owner)
	return nil
}

// CleanupTempFiles removes files this import created on the node (exact paths only)
func (e *Enhance) CleanupTempFiles(ctx context.Context) error {
	if e.node == nil {
		return nil
	}
	for _, p := range e.tmpPaths {
		if !strings.HasPrefix(p, "/tmp/migration_") {
			continue
		}
		if _, err := e.nodeRun(ctx, "rm -f "+shq(p)); err != nil {
			e.warnf("could not remove %s on node: %v", p, err)
		}
	}
	e.tmpPaths = nil
	return nil
}

// defaultPHPExtensions are enabled on every migrated website (baseline requested by the operator);
// the ionCube loader is switched on as well because shop plugins depend on it.
var defaultPHPExtensions = []string{"apcu", "brotli"}

// configurePHP enables the baseline PHP extensions and the ionCube loader for a website (warnings only).
func (e *Enhance) configurePHP(ctx context.Context, ws *EnhanceWebsite) {
	domain := ws.Domain.Domain
	has := func(list []string, name string) bool {
		for _, x := range list {
			if strings.EqualFold(x, name) {
				return true
			}
		}
		return false
	}
	var available, enabled []string
	raw, err := e.apiRequest(ctx, "GET", fmt.Sprintf("/websites/%s/available_php_extensions", ws.ID), nil)
	if err != nil {
		e.warnf("PHP extensions for %s not configured: cannot list available extensions: %v", domain, err)
		return
	}
	_ = json.Unmarshal(raw, &available)
	if raw, err := e.apiRequest(ctx, "GET", fmt.Sprintf("/websites/%s/php_extensions", ws.ID), nil); err == nil {
		_ = json.Unmarshal(raw, &enabled)
	}

	var turnedOn, already, missing []string
	for _, ext := range defaultPHPExtensions {
		switch {
		case has(enabled, ext):
			already = append(already, ext)
		case !has(available, ext):
			missing = append(missing, ext)
		default:
			if _, err := e.apiRequest(ctx, "POST", fmt.Sprintf("/websites/%s/php_extensions", ws.ID), ext); err != nil {
				e.warnf("PHP extension %s not enabled for %s: %v", ext, domain, err)
			} else {
				turnedOn = append(turnedOn, ext)
			}
		}
	}
	if len(missing) > 0 {
		e.warnf("PHP extensions not available for %s on its PHP version: %s", domain, strings.Join(missing, ", "))
	}

	ion := "unchanged"
	var ionOn bool
	if raw, err := e.apiRequest(ctx, "GET", fmt.Sprintf("/websites/%s/ioncube", ws.ID), nil); err == nil {
		_ = json.Unmarshal(raw, &ionOn)
	}
	switch {
	case ionOn:
		ion = "already on"
	default:
		if _, err := e.apiRequest(ctx, "PUT", fmt.Sprintf("/websites/%s/ioncube", ws.ID), true); err != nil {
			e.warnf("ionCube loader not enabled for %s: %v", domain, err)
			ion = "failed"
		} else {
			ion = "enabled"
		}
	}

	// Verify what the API reports now.
	var after []string
	if raw, err := e.apiRequest(ctx, "GET", fmt.Sprintf("/websites/%s/php_extensions", ws.ID), nil); err == nil {
		_ = json.Unmarshal(raw, &after)
	}
	for _, ext := range turnedOn {
		if !has(after, ext) {
			e.warnf("PHP extension %s for %s was accepted by the API but is not reported as enabled", ext, domain)
		}
	}
	join := func(l []string) string {
		if len(l) == 0 {
			return "none"
		}
		return strings.Join(l, ", ")
	}
	e.logf("info", "PHP for %s: extensions enabled now: %s; already on: %s; ionCube loader: %s", domain, join(turnedOn), join(already), ion)
}
