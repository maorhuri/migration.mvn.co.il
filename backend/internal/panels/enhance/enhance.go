// Package enhance implements Enhance panel operations via API
package enhance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/ssh"
)

// Enhance implements the Panel interface for Enhance servers
type Enhance struct {
	config                *common.ConnectionConfig
	apiKey                string
	httpClient            *http.Client
	sshClient             *ssh.Client
	connected             bool
	targetClusterServerID string // Target server ID for website creation
}

// New creates a new Enhance panel instance
func New() *Enhance {
	return &Enhance{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		sshClient: ssh.NewClient(),
	}
}

// Connect establishes connection to the Enhance server
func (e *Enhance) Connect(ctx context.Context, config *common.ConnectionConfig) error {
	e.config = config
	return nil
}

// ConnectWithCredentials connects with API key and optionally SSH
func (e *Enhance) ConnectWithCredentials(ctx context.Context, config *common.ConnectionConfig, apiKey string, password string, privateKey []byte) error {
	e.config = config
	e.apiKey = apiKey

	// Connect via SSH if credentials provided (for file transfers)
	if config.AuthMethod == common.AuthMethodSSHKey || config.AuthMethod == common.AuthMethodPassword {
		if err := e.sshClient.Connect(ctx, config, password, privateKey); err != nil {
			return fmt.Errorf("failed to connect via SSH: %w", err)
		}
		if err := e.sshClient.ConnectSFTP(); err != nil {
			return fmt.Errorf("failed to connect via SFTP: %w", err)
		}
	}

	e.connected = true
	return nil
}

// Disconnect closes the connection
func (e *Enhance) Disconnect() error {
	e.connected = false
	return e.sshClient.Disconnect()
}

// SetTargetClusterServerID sets the target server ID for website creation
func (e *Enhance) SetTargetClusterServerID(serverID string) {
	e.targetClusterServerID = serverID
}

// TestConnection tests if the connection is working
func (e *Enhance) TestConnection(ctx context.Context) error {
	if !e.connected {
		return fmt.Errorf("not connected")
	}

	// Test API connection using /servers endpoint (always accessible)
	_, err := e.apiRequest(ctx, "GET", "/servers", nil)
	if err != nil {
		return fmt.Errorf("API connection failed: %w", err)
	}

	return nil
}

// GetPanelType returns the panel type
func (e *Enhance) GetPanelType() common.PanelType {
	return common.PanelTypeEnhance
}

// apiRequest makes an API request to Enhance
func (e *Enhance) apiRequest(ctx context.Context, method, endpoint string, body interface{}) ([]byte, error) {
	// Ensure endpoint starts with /v2
	if !strings.HasPrefix(endpoint, "/v2") {
		endpoint = "/v2" + endpoint
	}
	url := fmt.Sprintf("%s%s", e.config.APIEndpoint, endpoint)

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

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", e.apiKey))
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
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

// EnhanceOrg represents an organization in Enhance
type EnhanceOrg struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// EnhanceWebsite represents a website in Enhance
// EnhanceDomain represents a domain object in Enhance API
type EnhanceDomain struct {
	ID     string `json:"id"`
	Domain string `json:"domain"`
}

type EnhanceWebsite struct {
	ID           string        `json:"id"`
	Domain       EnhanceDomain `json:"domain"`
	DomainStr    string        `json:"-"` // For convenience
	Kind         string        `json:"kind"`
	Status       string        `json:"status"`
	ServerID     string        `json:"serverId"`
	AppServerID  string        `json:"appServerId"`
	DbServerID   string        `json:"dbServerId"`
	MailServerID string        `json:"mailServerId"`
	UnixUser     string        `json:"unixUser"`
	HomeDir      string        `json:"homeDir"`
}

// EnhanceDatabase represents a database in Enhance
type EnhanceDatabase struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

// EnhanceEmail represents an email account in Enhance
type EnhanceEmail struct {
	ID      string `json:"id"`
	Address string `json:"address"`
	QuotaMB int64  `json:"quotaMb"`
	UsedMB  int64  `json:"usedMb"`
}

// EnhanceServer represents a server in Enhance cluster
type EnhanceServer struct {
	ID           string `json:"id"`
	FriendlyName string `json:"friendlyName"`
	Hostname     string `json:"hostname"`
	IP           string `json:"primaryIpv4"`
	Role         string `json:"role"`
	IsMain       bool   `json:"isControlPanel"`
	Status       string `json:"status"`
}

// ListServers returns all servers in the Enhance cluster
func (e *Enhance) ListServers(ctx context.Context) ([]EnhanceServer, error) {
	if !e.connected {
		return nil, fmt.Errorf("not connected")
	}

	resp, err := e.apiRequest(ctx, "GET", "/servers", nil)
	if err != nil {
		return nil, err
	}

	var serversResponse struct {
		Items []EnhanceServer `json:"items"`
	}
	if err := json.Unmarshal(resp, &serversResponse); err != nil {
		return nil, fmt.Errorf("failed to parse servers response: %w", err)
	}

	return serversResponse.Items, nil
}

// CreateWebsiteOnServer creates a website on a specific server in the cluster
func (e *Enhance) CreateWebsiteOnServer(ctx context.Context, orgID string, domain string, serverID string) (*EnhanceWebsite, error) {
	if !e.connected {
		return nil, fmt.Errorf("not connected")
	}

	websiteReq := map[string]interface{}{
		"domain": domain,
		"kind":   "website",
	}

	// If serverID is provided, specify the target server
	if serverID != "" {
		websiteReq["appServerId"] = serverID
		websiteReq["dbServerId"] = serverID
		websiteReq["mailServerId"] = serverID
	}

	endpoint := fmt.Sprintf("/orgs/%s/websites", orgID)
	resp, err := e.apiRequest(ctx, "POST", endpoint, websiteReq)
	if err != nil {
		return nil, err
	}

	var website EnhanceWebsite
	if err := json.Unmarshal(resp, &website); err != nil {
		return nil, fmt.Errorf("failed to parse website response: %w", err)
	}

	return &website, nil
}

// GetWebsiteInfo returns detailed info about a website including paths
func (e *Enhance) GetWebsiteInfo(ctx context.Context, orgID string, websiteID string) (*EnhanceWebsite, error) {
	if !e.connected {
		return nil, fmt.Errorf("not connected")
	}

	endpoint := fmt.Sprintf("/orgs/%s/websites/%s", orgID, websiteID)
	resp, err := e.apiRequest(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, err
	}

	var website EnhanceWebsite
	if err := json.Unmarshal(resp, &website); err != nil {
		return nil, fmt.Errorf("failed to parse website response: %w", err)
	}

	return &website, nil
}

// UploadToTmp uploads files to /tmp on the main server
func (e *Enhance) UploadToTmp(ctx context.Context, localPath string, remoteName string) (string, error) {
	if !e.connected {
		return "", fmt.Errorf("not connected")
	}

	remotePath := fmt.Sprintf("/tmp/migration_%s_%d", remoteName, time.Now().Unix())

	// Create remote directory
	if _, err := e.sshClient.RunCommand(ctx, fmt.Sprintf("mkdir -p %s", remotePath)); err != nil {
		return "", fmt.Errorf("failed to create tmp directory: %w", err)
	}

	// Upload files
	progressChan := make(chan int64, 100)
	go func() {
		for range progressChan {
			// Just drain the channel
		}
	}()

	if err := e.sshClient.UploadDirectory(ctx, localPath, remotePath, progressChan); err != nil {
		close(progressChan)
		return "", fmt.Errorf("failed to upload to tmp: %w", err)
	}
	close(progressChan)

	return remotePath, nil
}

// MoveFromTmpToWebsite moves files from /tmp to the website directory
// If the website is on a different server, it uses rsync internally
func (e *Enhance) MoveFromTmpToWebsite(ctx context.Context, tmpPath string, website *EnhanceWebsite) error {
	if !e.connected {
		return fmt.Errorf("not connected")
	}

	destPath := filepath.Join(website.HomeDir, "public_html")

	// Check if we need to rsync to another server
	// The main server has access to all servers in the cluster
	cmd := fmt.Sprintf("rsync -avz --delete %s/ %s/", tmpPath, destPath)

	if _, err := e.sshClient.RunCommand(ctx, cmd); err != nil {
		return fmt.Errorf("failed to move files: %w", err)
	}

	// Cleanup tmp
	cleanupCmd := fmt.Sprintf("rm -rf %s", tmpPath)
	e.sshClient.RunCommand(ctx, cleanupCmd)

	// Fix permissions
	chownCmd := fmt.Sprintf("chown -R %s:%s %s", website.UnixUser, website.UnixUser, destPath)
	e.sshClient.RunCommand(ctx, chownCmd)

	return nil
}

// ListAccounts returns all accounts (organizations) on the server
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
			Metadata: map[string]string{
				"org_id": org.ID,
			},
		})
	}

	return accounts, nil
}

// GetAccount returns details for a specific account
func (e *Enhance) GetAccount(ctx context.Context, username string) (*common.Account, error) {
	// In Enhance, we work with organizations
	accounts, err := e.ListAccounts(ctx)
	if err != nil {
		return nil, err
	}

	for _, acc := range accounts {
		if acc.Username == username {
			return &acc, nil
		}
	}

	return nil, fmt.Errorf("account not found: %s", username)
}

// CreateAccount creates a new organization and website in Enhance
func (e *Enhance) CreateAccount(ctx context.Context, account *common.Account, password string) error {
	if !e.connected {
		return fmt.Errorf("not connected")
	}

	// Create organization
	orgReq := map[string]interface{}{
		"name": account.Username,
	}

	resp, err := e.apiRequest(ctx, "POST", "/orgs", orgReq)
	if err != nil {
		return fmt.Errorf("failed to create organization: %w", err)
	}

	var orgResp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(resp, &orgResp); err != nil {
		return fmt.Errorf("failed to parse org response: %w", err)
	}

	// Store org ID in metadata
	if account.Metadata == nil {
		account.Metadata = make(map[string]string)
	}
	account.Metadata["org_id"] = orgResp.ID

	return nil
}

// ImportAccount imports all data for an account
func (e *Enhance) ImportAccount(ctx context.Context, data *common.ExportData, password string, progress chan<- common.MigrationProgress) (*common.Account, error) {
	if !e.connected {
		return nil, fmt.Errorf("not connected")
	}

	sendProgress := func(step string, completed, total int) {
		if progress != nil {
			progress <- common.MigrationProgress{
				Status:         "running",
				CurrentStep:    step,
				TotalSteps:     total,
				CompletedSteps: completed,
			}
		}
	}

	totalSteps := 5
	currentStep := 0

	// Get org_id from config metadata (already exists in Enhance)
	orgID := ""
	if e.config != nil && e.config.Metadata != nil {
		orgID = e.config.Metadata["enhance_org_id"]
	}
	if orgID == "" {
		return nil, fmt.Errorf("enhance_org_id not configured - please set it in server settings")
	}

	// Store org_id in account metadata for later use
	if data.Account.Metadata == nil {
		data.Account.Metadata = make(map[string]string)
	}
	data.Account.Metadata["org_id"] = orgID

	// 1. Create websites (domains)
	sendProgress("Creating websites", currentStep, totalSteps)
	for _, domain := range data.Domains {
		if err := e.createWebsite(ctx, orgID, &domain); err != nil {
			fmt.Printf("Warning: failed to create website %s: %v\n", domain.Name, err)
		}
	}
	currentStep++

	// 2. Import databases
	sendProgress("Importing databases", currentStep, totalSteps)
	if len(data.Databases) > 0 {
		dbDir := filepath.Join(filepath.Dir(data.FilesPath), "databases")
		if err := e.ImportDatabases(ctx, data.Account.Username, data.Databases, dbDir); err != nil {
			fmt.Printf("Warning: failed to import databases: %v\n", err)
		}
	}
	currentStep++

	// 3. Import emails
	sendProgress("Importing email accounts", currentStep, totalSteps)
	if len(data.Emails) > 0 {
		if err := e.ImportEmails(ctx, data.Account.Username, data.Emails); err != nil {
			fmt.Printf("Warning: failed to import emails: %v\n", err)
		}
	}
	currentStep++

	// 4. Import files
	sendProgress("Importing files", currentStep, totalSteps)
	if data.FilesPath != "" {
		if err := e.ImportFiles(ctx, data.Account.Username, data.FilesPath, progress); err != nil {
			return nil, fmt.Errorf("failed to import files: %w", err)
		}
	}
	currentStep++

	// 5. Setup SSL certificates
	sendProgress("Setting up SSL certificates", currentStep, totalSteps)
	for _, domain := range data.Domains {
		if domain.SSL != nil {
			if err := e.SetupSSL(ctx, domain.Name, domain.SSL); err != nil {
				fmt.Printf("Warning: failed to setup SSL for %s: %v\n", domain.Name, err)
			}
		}
	}
	currentStep++

	return &data.Account, nil
}

// createWebsite creates a website in Enhance
func (e *Enhance) createWebsite(ctx context.Context, orgID string, domain *common.Domain) error {
	websiteReq := map[string]interface{}{
		"domain": domain.Name,
		"kind":   "website",
	}

	// If target cluster server ID is specified, use it for website placement
	if e.targetClusterServerID != "" {
		websiteReq["appServerId"] = e.targetClusterServerID
		websiteReq["dbServerId"] = e.targetClusterServerID
	}

	// Set PHP version from source domain if available
	if domain.PHPVersion != "" {
		phpVersion := e.mapPHPVersion(domain.PHPVersion)
		if phpVersion != "" {
			websiteReq["phpVersion"] = phpVersion
		}
	}

	endpoint := fmt.Sprintf("/orgs/%s/websites", orgID)
	_, err := e.apiRequest(ctx, "POST", endpoint, websiteReq)
	if err != nil {
		return err
	}

	return nil
}

// mapPHPVersion converts PHP version from DirectAdmin format to Enhance format
func (e *Enhance) mapPHPVersion(version string) string {
	// DirectAdmin formats: "8.1", "8.2", "7.4", "default", etc.
	// Enhance formats: "php81", "php82", "php74", etc.

	// Handle default/empty - use PHP 8.1 as default
	if version == "" || version == "default" || version == "phpdefault" {
		return "php81"
	}

	// Remove dots and add "php" prefix
	version = strings.TrimPrefix(version, "php")
	version = strings.Replace(version, ".", "", -1)

	// Valid PHP versions for Enhance
	validVersions := map[string]bool{
		"56": true, "70": true, "71": true, "72": true, "73": true,
		"74": true, "80": true, "81": true, "82": true, "83": true, "84": true,
	}

	// Validate it's a reasonable PHP version
	if len(version) >= 2 && validVersions[version] {
		return "php" + version
	}

	// Default to PHP 8.1 if invalid
	return "php81"
}

// getWebsiteByDomain gets a website by domain name
func (e *Enhance) getWebsiteByDomain(ctx context.Context, orgID, domain string) (*EnhanceWebsite, error) {
	endpoint := fmt.Sprintf("/orgs/%s/websites", orgID)
	resp, err := e.apiRequest(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, err
	}

	var websitesResp struct {
		Items []EnhanceWebsite `json:"items"`
	}
	if err := json.Unmarshal(resp, &websitesResp); err != nil {
		return nil, err
	}

	for _, ws := range websitesResp.Items {
		// Domain is now an object with a domain field
		if ws.Domain.Domain == domain {
			ws.DomainStr = ws.Domain.Domain
			return &ws, nil
		}
	}

	return nil, fmt.Errorf("website not found: %s", domain)
}

// ImportFiles imports files to an account via SFTP/rsync
func (e *Enhance) ImportFiles(ctx context.Context, username string, sourcePath string, progress chan<- common.MigrationProgress) error {
	if !e.connected {
		return fmt.Errorf("not connected")
	}

	// Get org_id from config metadata
	orgID := ""
	if e.config != nil && e.config.Metadata != nil {
		orgID = e.config.Metadata["enhance_org_id"]
	}
	if orgID == "" {
		return fmt.Errorf("enhance_org_id not configured")
	}

	// Get websites for this org
	endpoint := fmt.Sprintf("/orgs/%s/websites", orgID)
	resp, err := e.apiRequest(ctx, "GET", endpoint, nil)
	if err != nil {
		return err
	}

	var websitesResp struct {
		Items []EnhanceWebsite `json:"items"`
	}
	if err := json.Unmarshal(resp, &websitesResp); err != nil {
		return err
	}

	if len(websitesResp.Items) == 0 {
		return fmt.Errorf("no websites found for organization")
	}

	// Upload files for each domain
	domainsDir := filepath.Join(sourcePath, "domains")
	entries, err := os.ReadDir(domainsDir)
	if err != nil {
		// Try direct upload if no domains subdirectory
		return e.uploadFilesToWebsite(ctx, &websitesResp.Items[0], sourcePath, progress)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		domainName := entry.Name()
		localPath := filepath.Join(domainsDir, domainName)

		// Find matching website
		for _, ws := range websitesResp.Items {
			if ws.Domain.Domain == domainName {
				if err := e.uploadFilesToWebsite(ctx, &ws, localPath, progress); err != nil {
					fmt.Printf("Warning: failed to upload files for %s: %v\n", domainName, err)
				}
				break
			}
		}
	}

	return nil
}

// uploadFilesToWebsite uploads files to a specific website
func (e *Enhance) uploadFilesToWebsite(ctx context.Context, website *EnhanceWebsite, localPath string, progress chan<- common.MigrationProgress) error {
	remotePath := filepath.Join(website.HomeDir, "public_html")

	// Check if public_html exists in local path
	publicHtmlLocal := filepath.Join(localPath, "public_html")
	if _, err := os.Stat(publicHtmlLocal); err == nil {
		localPath = publicHtmlLocal
	}

	if progress != nil {
		progress <- common.MigrationProgress{
			Status:      "running",
			CurrentStep: fmt.Sprintf("Uploading files to %s", website.Domain),
		}
	}

	// Use rsync/tar for faster upload
	err := e.sshClient.RsyncUploadWithKey(ctx, localPath, remotePath)
	if err != nil {
		return fmt.Errorf("failed to upload files: %w", err)
	}

	return nil
}

// ImportDatabases imports databases to Enhance
func (e *Enhance) ImportDatabases(ctx context.Context, username string, databases []common.Database, dumpDir string) error {
	if !e.connected {
		return fmt.Errorf("not connected")
	}

	// Get org_id from config metadata
	orgID := ""
	if e.config != nil && e.config.Metadata != nil {
		orgID = e.config.Metadata["enhance_org_id"]
	}
	if orgID == "" {
		return fmt.Errorf("enhance_org_id not configured")
	}

	// Get first website for this org
	endpoint := fmt.Sprintf("/orgs/%s/websites", orgID)
	resp, err := e.apiRequest(ctx, "GET", endpoint, nil)
	if err != nil {
		return err
	}

	var websitesResp struct {
		Items []EnhanceWebsite `json:"items"`
	}
	if err := json.Unmarshal(resp, &websitesResp); err != nil {
		return err
	}

	if len(websitesResp.Items) == 0 {
		return fmt.Errorf("no websites found for organization")
	}

	website := websitesResp.Items[0]

	for _, db := range databases {
		// Create database via API
		dbReq := map[string]interface{}{
			"name": db.Name,
			"kind": "mysql",
		}

		dbEndpoint := fmt.Sprintf("/orgs/%s/websites/%s/mysql-dbs", orgID, website.ID)
		dbResp, err := e.apiRequest(ctx, "POST", dbEndpoint, dbReq)
		if err != nil {
			fmt.Printf("Warning: failed to create database %s: %v\n", db.Name, err)
			continue
		}

		var newDB struct {
			ID string `json:"id"`
		}
		json.Unmarshal(dbResp, &newDB)

		// Create database users
		for _, user := range db.Users {
			userReq := map[string]interface{}{
				"username": user.Username,
			}
			userEndpoint := fmt.Sprintf("/orgs/%s/websites/%s/mysql-dbs/%s/users", orgID, website.ID, newDB.ID)
			e.apiRequest(ctx, "POST", userEndpoint, userReq)
		}

		// Import dump file if exists
		dumpFile := filepath.Join(dumpDir, fmt.Sprintf("%s.sql", db.Name))
		if _, err := os.Stat(dumpFile); err == nil {
			// Upload dump file
			remoteDumpPath := fmt.Sprintf("/tmp/%s_%d.sql", db.Name, time.Now().Unix())
			if err := e.sshClient.Upload(ctx, dumpFile, remoteDumpPath); err != nil {
				fmt.Printf("Warning: failed to upload dump for %s: %v\n", db.Name, err)
				continue
			}

			// Import dump
			// Note: This requires knowing the database credentials
			// In production, you'd get these from the API or use a different import method
			importCmd := fmt.Sprintf("mysql %s < %s && rm -f %s", db.Name, remoteDumpPath, remoteDumpPath)
			if _, err := e.sshClient.RunCommand(ctx, importCmd); err != nil {
				fmt.Printf("Warning: failed to import dump for %s: %v\n", db.Name, err)
			}
		}
	}

	return nil
}

// ImportEmails imports email accounts to Enhance
func (e *Enhance) ImportEmails(ctx context.Context, username string, emails []common.EmailAccount) error {
	if !e.connected {
		return fmt.Errorf("not connected")
	}

	// Get org_id from config metadata
	orgID := ""
	if e.config != nil && e.config.Metadata != nil {
		orgID = e.config.Metadata["enhance_org_id"]
	}
	if orgID == "" {
		return fmt.Errorf("enhance_org_id not configured")
	}

	// Get websites
	endpoint := fmt.Sprintf("/orgs/%s/websites", orgID)
	resp, err := e.apiRequest(ctx, "GET", endpoint, nil)
	if err != nil {
		return err
	}

	var websitesResp struct {
		Items []EnhanceWebsite `json:"items"`
	}
	if err := json.Unmarshal(resp, &websitesResp); err != nil {
		return err
	}

	for _, email := range emails {
		parts := strings.Split(email.Email, "@")
		if len(parts) != 2 {
			continue
		}

		localPart := parts[0]
		domain := parts[1]

		// Find website for this domain
		var websiteID string
		for _, ws := range websitesResp.Items {
			if ws.Domain.Domain == domain {
				websiteID = ws.ID
				break
			}
		}

		if websiteID == "" {
			fmt.Printf("Warning: no website found for email domain %s\n", domain)
			continue
		}

		// Create email account
		emailReq := map[string]interface{}{
			"address": localPart,
			"quotaMb": email.Quota / (1024 * 1024), // Convert bytes to MB
		}

		emailEndpoint := fmt.Sprintf("/orgs/%s/websites/%s/emails", orgID, websiteID)
		if _, err := e.apiRequest(ctx, "POST", emailEndpoint, emailReq); err != nil {
			fmt.Printf("Warning: failed to create email %s: %v\n", email.Email, err)
		}
	}

	return nil
}

// ImportCronJobs imports cron jobs to Enhance
func (e *Enhance) ImportCronJobs(ctx context.Context, username string, cronJobs []common.CronJob) error {
	if !e.connected {
		return fmt.Errorf("not connected")
	}

	// Get org_id from config metadata
	orgID := ""
	if e.config != nil && e.config.Metadata != nil {
		orgID = e.config.Metadata["enhance_org_id"]
	}
	if orgID == "" {
		return fmt.Errorf("enhance_org_id not configured")
	}

	// Get first website for this org
	endpoint := fmt.Sprintf("/orgs/%s/websites", orgID)
	resp, err := e.apiRequest(ctx, "GET", endpoint, nil)
	if err != nil {
		return err
	}

	var websitesResp struct {
		Items []EnhanceWebsite `json:"items"`
	}
	if err := json.Unmarshal(resp, &websitesResp); err != nil {
		return err
	}

	if len(websitesResp.Items) == 0 {
		return fmt.Errorf("no websites found for organization")
	}

	website := websitesResp.Items[0]

	for _, cron := range cronJobs {
		// Create cron job via API
		cronReq := map[string]interface{}{
			"minute":  cron.Minute,
			"hour":    cron.Hour,
			"day":     cron.Day,
			"month":   cron.Month,
			"weekday": cron.Weekday,
			"command": cron.Command,
		}

		cronEndpoint := fmt.Sprintf("/orgs/%s/websites/%s/cron-jobs", orgID, website.ID)
		if _, err := e.apiRequest(ctx, "POST", cronEndpoint, cronReq); err != nil {
			fmt.Printf("Warning: failed to create cron job: %v\n", err)
		}
	}

	return nil
}

// ImportEmailData imports email maildir data to Enhance
func (e *Enhance) ImportEmailData(ctx context.Context, website *EnhanceWebsite, emailUser string, localMailDir string) error {
	if !e.connected {
		return fmt.Errorf("not connected")
	}

	// Upload maildir to the correct location
	// Enhance uses /home/<unixuser>/mail/<domain>/<user>/
	remoteMailDir := fmt.Sprintf("/home/%s/mail/%s/%s", website.UnixUser, website.Domain, emailUser)

	// Create directory
	mkdirCmd := fmt.Sprintf("mkdir -p %s", remoteMailDir)
	if _, err := e.sshClient.RunCommand(ctx, mkdirCmd); err != nil {
		return fmt.Errorf("failed to create mail directory: %w", err)
	}

	// Upload maildir
	progressChan := make(chan int64, 100)
	go func() {
		for range progressChan {
		}
	}()

	if err := e.sshClient.UploadDirectory(ctx, localMailDir, remoteMailDir, progressChan); err != nil {
		close(progressChan)
		return fmt.Errorf("failed to upload maildir: %w", err)
	}
	close(progressChan)

	// Fix permissions
	chownCmd := fmt.Sprintf("chown -R %s:%s %s", website.UnixUser, website.UnixUser, remoteMailDir)
	e.sshClient.RunCommand(ctx, chownCmd)

	return nil
}

// SetupDomain configures a domain in Enhance
func (e *Enhance) SetupDomain(ctx context.Context, username string, domain *common.Domain) error {
	if !e.connected {
		return fmt.Errorf("not connected")
	}

	// Get org_id from config metadata
	orgID := ""
	if e.config != nil && e.config.Metadata != nil {
		orgID = e.config.Metadata["enhance_org_id"]
	}
	if orgID == "" {
		return fmt.Errorf("enhance_org_id not configured")
	}

	return e.createWebsite(ctx, orgID, domain)
}

// SetupSSL configures SSL for a domain in Enhance
func (e *Enhance) SetupSSL(ctx context.Context, domain string, cert *common.SSLCert) error {
	if !e.connected {
		return fmt.Errorf("not connected")
	}

	// Get org_id from config metadata
	orgID := ""
	if e.config != nil && e.config.Metadata != nil {
		orgID = e.config.Metadata["enhance_org_id"]
	}
	if orgID == "" {
		return fmt.Errorf("enhance_org_id not configured")
	}

	website, err := e.getWebsiteByDomain(ctx, orgID, domain)
	if err != nil {
		return fmt.Errorf("website not found for domain %s: %w", domain, err)
	}

	// Upload SSL certificate
	sslReq := map[string]interface{}{
		"cert":  cert.Certificate,
		"key":   cert.PrivateKey,
		"chain": cert.CABundle,
	}

	endpoint := fmt.Sprintf("/orgs/%s/websites/%s/ssl", orgID, website.ID)
	if _, err := e.apiRequest(ctx, "POST", endpoint, sslReq); err != nil {
		return fmt.Errorf("failed to setup SSL: %w", err)
	}

	return nil
}

// ExportAccount exports all data for an account (for backup purposes)
func (e *Enhance) ExportAccount(ctx context.Context, username string, outputDir string, progress chan<- common.MigrationProgress) (*common.ExportData, error) {
	return nil, fmt.Errorf("Enhance export not implemented - use DirectAdmin for export")
}

// ExportFiles exports files for an account
func (e *Enhance) ExportFiles(ctx context.Context, username string, outputDir string, progress chan<- common.MigrationProgress) error {
	return fmt.Errorf("Enhance export not implemented - use DirectAdmin for export")
}

// ExportDatabases exports databases for an account
func (e *Enhance) ExportDatabases(ctx context.Context, username string, outputDir string) ([]common.Database, error) {
	return nil, fmt.Errorf("Enhance export not implemented - use DirectAdmin for export")
}

// ExportEmails exports email accounts and data
func (e *Enhance) ExportEmails(ctx context.Context, username string, outputDir string) ([]common.EmailAccount, error) {
	return nil, fmt.Errorf("Enhance export not implemented - use DirectAdmin for export")
}

// uploadFile uploads a file using multipart form
func (e *Enhance) uploadFile(ctx context.Context, endpoint, fieldName, filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile(fieldName, filepath.Base(filePath))
	if err != nil {
		return fmt.Errorf("failed to create form file: %w", err)
	}

	if _, err := io.Copy(part, file); err != nil {
		return fmt.Errorf("failed to copy file: %w", err)
	}

	if err := writer.Close(); err != nil {
		return fmt.Errorf("failed to close writer: %w", err)
	}

	url := fmt.Sprintf("%s%s", e.config.APIEndpoint, endpoint)
	req, err := http.NewRequestWithContext(ctx, "POST", url, body)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", e.apiKey))
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("upload failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// FixPermissions fixes file permissions for a website
func (e *Enhance) FixPermissions(ctx context.Context, websitePath, unixUser string) error {
	if !e.connected || e.sshClient == nil {
		return fmt.Errorf("SSH not connected")
	}

	// Change ownership to the website user
	chownCmd := fmt.Sprintf("chown -R %s:%s %s", unixUser, unixUser, websitePath)
	if _, err := e.sshClient.RunCommand(ctx, chownCmd); err != nil {
		return fmt.Errorf("failed to change ownership: %w", err)
	}

	// Fix directory permissions (775)
	dirPermCmd := fmt.Sprintf("find %s -type d -exec chmod 775 {} \\;", websitePath)
	if _, err := e.sshClient.RunCommand(ctx, dirPermCmd); err != nil {
		fmt.Printf("Warning: failed to fix directory permissions: %v\n", err)
	}

	// Fix file permissions (644)
	filePermCmd := fmt.Sprintf("find %s -type f -exec chmod 644 {} \\;", websitePath)
	if _, err := e.sshClient.RunCommand(ctx, filePermCmd); err != nil {
		fmt.Printf("Warning: failed to fix file permissions: %v\n", err)
	}

	// Secure wp-config.php if exists
	wpConfigPath := filepath.Join(websitePath, "wp-config.php")
	secureWpCmd := fmt.Sprintf("[ -f %s ] && chmod 600 %s || true", wpConfigPath, wpConfigPath)
	e.sshClient.RunCommand(ctx, secureWpCmd)

	return nil
}

// CleanupTempFiles removes temporary migration files from the server
func (e *Enhance) CleanupTempFiles(ctx context.Context, paths []string) error {
	if !e.connected || e.sshClient == nil {
		return fmt.Errorf("SSH not connected")
	}

	for _, path := range paths {
		// Safety check - only delete from /tmp or specific migration directories
		if !strings.HasPrefix(path, "/tmp/") && !strings.Contains(path, "migration") {
			fmt.Printf("Skipping cleanup of unsafe path: %s\n", path)
			continue
		}

		rmCmd := fmt.Sprintf("rm -rf %s", path)
		if _, err := e.sshClient.RunCommand(ctx, rmCmd); err != nil {
			fmt.Printf("Warning: failed to cleanup %s: %v\n", path, err)
		} else {
			fmt.Printf("Cleaned up: %s\n", path)
		}
	}

	return nil
}
