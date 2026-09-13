// Package migration provides the migration engine
package migration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/panels/directadmin"
	"github.com/migration-tool/backend/internal/panels/enhance"
	"github.com/migration-tool/backend/internal/ssh"
	"github.com/migration-tool/backend/internal/storage"
	"github.com/migration-tool/backend/pkg/logger"
)

// Engine handles migration operations
type Engine struct {
	db      *storage.Database
	logger  *logger.Logger
	workDir string
}

// NewEngine creates a new migration engine
func NewEngine(db *storage.Database, log *logger.Logger, workDir string) *Engine {
	return &Engine{db: db, logger: log, workDir: workDir}
}

// ErrClusterServerRequired is returned when an Enhance target is used without an explicit cluster server.
var ErrClusterServerRequired = errors.New("target cluster server must be selected for Enhance targets: refusing to create websites with default placement")

// MigrationRequest represents a migration request
type MigrationRequest struct {
	SourceServerID        string `json:"source_server_id"`
	TargetServerID        string `json:"target_server_id"`
	TargetClusterServerID string `json:"target_cluster_server_id,omitempty"` // For Enhance: specific server in cluster
	Username              string `json:"username"`
	NewPassword           string `json:"new_password,omitempty"` // Password for new account
}

// MigrationResult represents the state of a migration as exposed by the API
type MigrationResult struct {
	ID              string                    `json:"id"`
	SourceServerID  string                    `json:"source_server_id"`
	TargetServerID  string                    `json:"target_server_id"`
	AccountUsername string                    `json:"account_username"`
	Status          string                    `json:"status"`
	CurrentStep     string                    `json:"current_step,omitempty"`
	TotalSteps      int                       `json:"total_steps"`
	CompletedSteps  int                       `json:"completed_steps"`
	TargetIP        string                    `json:"target_ip,omitempty"`
	TargetNode      string                    `json:"target_node,omitempty"`
	Warnings        int                       `json:"warnings"`
	ExportData      *common.ExportData        `json:"export_data,omitempty"`
	Error           string                    `json:"error,omitempty"`
	CreatedAt       time.Time                 `json:"created_at"`
	StartedAt       time.Time                 `json:"started_at"`
	CompletedAt     *time.Time                `json:"completed_at,omitempty"`
	Progress        *common.MigrationProgress `json:"progress,omitempty"`
}

// StartMigration starts a new migration
func (e *Engine) StartMigration(ctx context.Context, req *MigrationRequest) (*MigrationResult, error) {
	migration := &storage.Migration{
		SourceServerID:  req.SourceServerID,
		TargetServerID:  req.TargetServerID,
		AccountUsername: req.Username,
	}
	if err := e.db.CreateMigration(ctx, migration); err != nil {
		return nil, fmt.Errorf("failed to create migration record: %w", err)
	}
	migrationID := migration.ID

	result := &MigrationResult{
		ID:              migrationID,
		SourceServerID:  req.SourceServerID,
		TargetServerID:  req.TargetServerID,
		AccountUsername: req.Username,
		Status:          "running",
		StartedAt:       time.Now(),
		Progress:        &common.MigrationProgress{ID: migrationID, Status: "running", StartedAt: time.Now()},
	}

	sourceServer, err := e.db.GetServer(ctx, req.SourceServerID)
	if err != nil {
		e.failMigration(ctx, migrationID, fmt.Sprintf("failed to get source server: %v", err))
		return nil, fmt.Errorf("failed to get source server: %w", err)
	}
	targetServer, err := e.db.GetServer(ctx, req.TargetServerID)
	if err != nil {
		e.failMigration(ctx, migrationID, fmt.Sprintf("failed to get target server: %v", err))
		return nil, fmt.Errorf("failed to get target server: %w", err)
	}

	// Safety: never let Enhance pick a default server on a production cluster.
	if common.PanelType(targetServer.PanelType) == common.PanelTypeEnhance && req.TargetClusterServerID == "" {
		e.failMigration(ctx, migrationID, ErrClusterServerRequired.Error())
		return nil, ErrClusterServerRequired
	}

	e.db.AddMigrationLog(ctx, migrationID, "info", "Migration requested", map[string]interface{}{
		"source":                   sourceServer.Name,
		"target":                   targetServer.Name,
		"target_cluster_server_id": req.TargetClusterServerID,
		"username":                 req.Username,
	})

	migrationDir := filepath.Join(e.workDir, migrationID)
	if err := os.MkdirAll(migrationDir, 0755); err != nil {
		e.failMigration(ctx, migrationID, fmt.Sprintf("failed to create work directory: %v", err))
		return nil, fmt.Errorf("failed to create work directory: %w", err)
	}

	// Run in background with a context that outlives the HTTP request
	go e.runMigration(context.Background(), migrationID, sourceServer, targetServer, req, migrationDir)

	return result, nil
}

// runMigration executes the migration process
func (e *Engine) runMigration(ctx context.Context, migrationID string, sourceServer, targetServer *storage.Server, req *MigrationRequest, workDir string) {
	progressChan := make(chan common.MigrationProgress, 100)
	go func() {
		for progress := range progressChan {
			progress.ID = migrationID
			e.db.UpdateMigrationProgress(ctx, migrationID, &progress)
			e.db.AddMigrationLog(ctx, migrationID, "info", progress.CurrentStep, nil)
		}
	}()
	defer close(progressChan)

	defer func() {
		if err := os.RemoveAll(workDir); err != nil {
			e.db.AddMigrationLog(ctx, migrationID, "warn", fmt.Sprintf("Local cleanup warning: %v", err), nil)
		}
	}()

	migrationLog := func(level, message string) {
		e.db.AddMigrationLog(ctx, migrationID, level, message, nil)
	}
	warnings := 0
	warn := func(format string, args ...interface{}) {
		warnings++
		migrationLog("warn", fmt.Sprintf(format, args...))
		e.db.SetMigrationWarnings(ctx, migrationID, warnings)
	}

	// Phase 1: export
	migrationLog("info", fmt.Sprintf("Starting export from %s (%s)", sourceServer.Name, sourceServer.PanelType))
	exportData, err := e.exportFromSource(ctx, sourceServer, req.Username, workDir, progressChan, migrationLog)
	if err != nil {
		e.failMigration(ctx, migrationID, fmt.Sprintf("export failed: %v", err))
		return
	}
	exportJSON, _ := json.Marshal(exportData)
	e.db.SetMigrationExportData(ctx, migrationID, exportJSON)
	e.db.AddMigrationLog(ctx, migrationID, "info", "Export completed", map[string]interface{}{
		"domains":   len(exportData.Domains),
		"databases": len(exportData.Databases),
		"emails":    len(exportData.Emails),
		"cron_jobs": len(exportData.CronJobs),
	})
	if len(exportData.Databases) == 0 && len(exportData.Account.Databases) > 0 {
		e.failMigration(ctx, migrationID, fmt.Sprintf("export found no database dumps although the account has databases (%s)", strings.Join(exportData.Account.Databases, ", ")))
		return
	}

	// Phase 2: import
	switch common.PanelType(targetServer.PanelType) {
	case common.PanelTypeEnhance:
		progressChan <- common.MigrationProgress{Status: "running", CurrentStep: "Connecting to cluster node"}
		en, err := e.connectEnhanceTarget(ctx, migrationID, targetServer, req.TargetClusterServerID, migrationLog)
		if err != nil {
			e.failMigration(ctx, migrationID, fmt.Sprintf("import failed: %v", err))
			return
		}
		defer en.Disconnect()
		defer en.CleanupTempFiles(ctx) // also on failure: never leave dumps in /tmp on the node

		result, err := en.ImportAccount(ctx, exportData, progressChan)
		warnings += len(en.Warnings())
		e.db.SetMigrationWarnings(ctx, migrationID, warnings)
		if err != nil {
			e.failMigration(ctx, migrationID, fmt.Sprintf("import failed: %v", err))
			return
		}
		summary, _ := json.Marshal(result)
		e.db.AddMigrationLog(ctx, migrationID, "info", "Import completed", map[string]interface{}{"result": string(summary)})

		// Phase 3: cleanup
		progressChan <- common.MigrationProgress{Status: "running", CurrentStep: "Cleaning up temporary files"}
		if err := en.CleanupTempFiles(ctx); err != nil {
			warn("Target cleanup warning: %v", err)
		}
	default:
		e.failMigration(ctx, migrationID, fmt.Sprintf("unsupported target panel type: %s", targetServer.PanelType))
		return
	}

	if err := e.cleanupSourceServer(ctx, sourceServer); err != nil {
		warn("Source cleanup warning: %v", err)
	}

	now := time.Now()
	e.db.UpdateMigrationProgress(ctx, migrationID, &common.MigrationProgress{
		ID: migrationID, Status: "completed", CurrentStep: "Migration completed", CompletedAt: &now,
	})
	e.db.SetMigrationWarnings(ctx, migrationID, warnings)
	if warnings > 0 {
		migrationLog("info", fmt.Sprintf("Migration completed with %d warning(s); review them before switching DNS", warnings))
	} else {
		migrationLog("info", "Migration completed successfully")
	}
}

// connectEnhanceTarget connects to the Enhance API and to the cluster node that will host the website.
func (e *Engine) connectEnhanceTarget(ctx context.Context, migrationID string, server *storage.Server, clusterServerID string, logFn enhance.LogFunc) (*enhance.Enhance, error) {
	config := e.db.ToConnectionConfig(server)
	apiKey, _ := e.db.GetServerAPIKey(ctx, server.ID)

	en := enhance.New()
	en.SetLogger(logFn)
	if err := en.ConnectAPI(ctx, config, apiKey); err != nil {
		return nil, err
	}
	if err := en.TestConnection(ctx); err != nil {
		return nil, fmt.Errorf("Enhance API test failed: %w", err)
	}
	en.SetTargetClusterServerID(clusterServerID)

	node, err := en.GetServer(ctx, clusterServerID)
	if err != nil {
		return nil, err
	}
	nodeIP := node.PrimaryIP()
	if nodeIP == "" {
		return nil, fmt.Errorf("cluster server %s (%s) has no IP in the Enhance API", node.FriendlyName, node.ID)
	}
	if node.IsDecommissioned {
		return nil, fmt.Errorf("cluster server %s is decommissioned", node.FriendlyName)
	}
	e.db.SetMigrationTarget(ctx, migrationID, nodeIP, node.FriendlyName)
	logFn("info", fmt.Sprintf("Target node: %s (hostname %s, ip %s, roles %s)", node.FriendlyName, node.Hostname, nodeIP, strings.Join(node.EnabledRoles(), ",")))

	// SSH credential candidates, tried in order:
	//   1. a server record whose host/name matches the node
	//   2. the SSH key marked as default (root@node:22)
	//   3. the Enhance entry's own credentials
	type attempt struct {
		label    string
		cfg      *common.ConnectionConfig
		password string
		key      []byte
	}
	baseCfg := func() *common.ConnectionConfig {
		return &common.ConnectionConfig{Host: nodeIP, Port: 22, Username: "root"}
	}
	var attempts []attempt

	if rec, err := e.db.FindServerByHost(ctx, nodeIP, node.FriendlyName, node.Hostname); err == nil && rec != nil && rec.ID != server.ID {
		cfg := baseCfg()
		if rec.Port > 0 {
			cfg.Port = rec.Port
		}
		if rec.Username != "" {
			cfg.Username = rec.Username
		}
		cfg.AuthMethod = common.AuthMethod(rec.AuthMethod)
		pw, _ := e.db.GetServerPassword(ctx, rec.ID)
		var key []byte
		if rec.SSHKeyID.Valid {
			kd, _ := e.db.GetSSHKeyPrivateKey(ctx, rec.SSHKeyID.String)
			key = []byte(kd)
		}
		attempts = append(attempts, attempt{fmt.Sprintf("server entry %q", rec.Name), cfg, pw, key})
	}

	if dk, err := e.db.GetDefaultSSHKey(ctx); err == nil && dk != nil {
		if kd, err := e.db.GetSSHKeyPrivateKey(ctx, dk.ID); err == nil && kd != "" {
			cfg := baseCfg()
			cfg.AuthMethod = common.AuthMethodSSHKey
			pass, _ := e.db.GetSSHKeyPassphrase(ctx, dk.ID)
			attempts = append(attempts, attempt{fmt.Sprintf("default SSH key %q", dk.Name), cfg, pass, []byte(kd)})
		}
	}

	{
		cfg := baseCfg()
		if server.Port > 0 {
			cfg.Port = server.Port
		}
		if server.Username != "" {
			cfg.Username = server.Username
		}
		cfg.AuthMethod = config.AuthMethod
		pw, _ := e.db.GetServerPassword(ctx, server.ID)
		var key []byte
		if server.SSHKeyID.Valid {
			kd, _ := e.db.GetSSHKeyPrivateKey(ctx, server.SSHKeyID.String)
			key = []byte(kd)
		}
		if cfg.AuthMethod == common.AuthMethodPassword || cfg.AuthMethod == common.AuthMethodSSHKey {
			attempts = append(attempts, attempt{fmt.Sprintf("credentials of %q", server.Name), cfg, pw, key})
		}
	}

	if len(attempts) == 0 {
		return nil, fmt.Errorf("no SSH credentials available for node %s (%s): generate an SSH key in the SSH Keys page, mark it as default and run its install command on the node", node.FriendlyName, nodeIP)
	}

	var failures []string
	for _, a := range attempts {
		logFn("info", fmt.Sprintf("Connecting to node %s:%d as %s using %s", nodeIP, a.cfg.Port, a.cfg.Username, a.label))
		if err := en.ConnectNode(ctx, a.cfg, a.password, a.key); err != nil {
			logFn("warn", fmt.Sprintf("%s: %v", a.label, err))
			failures = append(failures, fmt.Sprintf("%s: %v", a.label, err))
			continue
		}
		return en, nil
	}
	return nil, fmt.Errorf("could not open root SSH to node %s (%s). Tried %s. Fix: in SSH Keys generate a key, mark it as default and run its install command on the node as root; or add a server entry for host %s with working root credentials",
		node.FriendlyName, nodeIP, strings.Join(failures, "; "), nodeIP)
}

// exportFromSource exports data from the source server
func (e *Engine) exportFromSource(ctx context.Context, server *storage.Server, username, workDir string, progress chan<- common.MigrationProgress, logFn func(level, message string)) (*common.ExportData, error) {
	config := e.db.ToConnectionConfig(server)
	password, _ := e.db.GetServerPassword(ctx, server.ID)
	var privateKey []byte
	if server.SSHKeyID.Valid {
		keyData, _ := e.db.GetSSHKeyPrivateKey(ctx, server.SSHKeyID.String)
		privateKey = []byte(keyData)
	}

	switch common.PanelType(server.PanelType) {
	case common.PanelTypeDirectAdmin:
		da := directadmin.New()
		da.SetLogger(logFn)
		if err := da.ConnectWithCredentials(ctx, config, password, privateKey); err != nil {
			return nil, fmt.Errorf("failed to connect to DirectAdmin: %w", err)
		}
		defer da.Disconnect()
		if err := da.TestConnection(ctx); err != nil {
			return nil, fmt.Errorf("DirectAdmin connection test failed: %w", err)
		}
		return da.ExportAccount(ctx, username, workDir, progress)
	default:
		return nil, fmt.Errorf("unsupported source panel type: %s", server.PanelType)
	}
}

// cleanupSourceServer removes temporary files from the source server
func (e *Engine) cleanupSourceServer(ctx context.Context, server *storage.Server) error {
	config := e.db.ToConnectionConfig(server)
	password, _ := e.db.GetServerPassword(ctx, server.ID)
	var privateKey []byte
	if server.SSHKeyID.Valid {
		keyData, _ := e.db.GetSSHKeyPrivateKey(ctx, server.SSHKeyID.String)
		privateKey = []byte(keyData)
	}
	switch common.PanelType(server.PanelType) {
	case common.PanelTypeDirectAdmin:
		da := directadmin.New()
		if err := da.ConnectWithCredentials(ctx, config, password, privateKey); err != nil {
			return fmt.Errorf("failed to connect to DirectAdmin: %w", err)
		}
		defer da.Disconnect()
		return da.CleanupTempFiles(ctx, []string{"/tmp/migration_*"})
	default:
		return nil
	}
}

// failMigration marks a migration as failed
func (e *Engine) failMigration(ctx context.Context, migrationID, errorMsg string) {
	now := time.Now()
	e.db.UpdateMigrationProgress(ctx, migrationID, &common.MigrationProgress{
		ID: migrationID, Status: "failed", Error: errorMsg, CompletedAt: &now,
	})
	e.db.AddMigrationLog(ctx, migrationID, "error", errorMsg, nil)
}

func toResult(m *storage.Migration) *MigrationResult {
	result := &MigrationResult{
		ID:              m.ID,
		SourceServerID:  m.SourceServerID,
		TargetServerID:  m.TargetServerID,
		AccountUsername: m.AccountUsername,
		Status:          m.Status,
		CurrentStep:     m.CurrentStep.String,
		TotalSteps:      m.TotalSteps,
		CompletedSteps:  m.CompletedSteps,
		TargetIP:        m.TargetIP.String,
		TargetNode:      m.TargetNode.String,
		Warnings:        m.Warnings,
		CreatedAt:       m.CreatedAt,
		StartedAt:       m.StartedAt.Time,
	}
	if m.CompletedAt.Valid {
		result.CompletedAt = &m.CompletedAt.Time
	}
	if m.ErrorMessage.Valid {
		result.Error = m.ErrorMessage.String
	}
	result.Progress = &common.MigrationProgress{
		ID:               m.ID,
		Status:           m.Status,
		CurrentStep:      m.CurrentStep.String,
		TotalSteps:       m.TotalSteps,
		CompletedSteps:   m.CompletedSteps,
		BytesTransferred: m.BytesTransferred,
		TotalBytes:       m.TotalBytes,
		StartedAt:        m.StartedAt.Time,
	}
	return result
}

// GetMigrationStatus gets the current status of a migration
func (e *Engine) GetMigrationStatus(ctx context.Context, migrationID string) (*MigrationResult, error) {
	migration, err := e.db.GetMigration(ctx, migrationID)
	if err != nil {
		return nil, err
	}
	result := toResult(migration)
	if migration.ExportData.Valid && migration.ExportData.Data != nil {
		var exportData common.ExportData
		if err := json.Unmarshal(migration.ExportData.Data, &exportData); err == nil {
			result.ExportData = &exportData
		}
	}
	return result, nil
}

// ListMigrations lists all migrations
func (e *Engine) ListMigrations(ctx context.Context) ([]*MigrationResult, error) {
	migrations, err := e.db.ListMigrations(ctx)
	if err != nil {
		return nil, err
	}
	results := make([]*MigrationResult, 0, len(migrations))
	for i := range migrations {
		results = append(results, toResult(&migrations[i]))
	}
	return results, nil
}

// GetMigrationLogs gets logs for a migration
func (e *Engine) GetMigrationLogs(ctx context.Context, migrationID string) ([]storage.MigrationLog, error) {
	return e.db.GetMigrationLogs(ctx, migrationID)
}

// CancelMigration marks a running or pending migration as cancelled
func (e *Engine) CancelMigration(ctx context.Context, migrationID string) error {
	migration, err := e.db.GetMigration(ctx, migrationID)
	if err != nil {
		return fmt.Errorf("migration not found: %w", err)
	}
	if migration.Status != "running" && migration.Status != "pending" {
		return fmt.Errorf("migration is not running or pending (status: %s)", migration.Status)
	}
	now := time.Now()
	return e.db.UpdateMigrationProgress(ctx, migrationID, &common.MigrationProgress{
		ID: migrationID, Status: "cancelled", Error: "Cancelled by user", CompletedAt: &now,
	})
}

// DeleteMigration deletes a migration record
func (e *Engine) DeleteMigration(ctx context.Context, migrationID string) error {
	migration, err := e.db.GetMigration(ctx, migrationID)
	if err != nil {
		return fmt.Errorf("migration not found: %w", err)
	}
	if migration.Status == "running" {
		return fmt.Errorf("cannot delete running migration")
	}
	return e.db.DeleteMigration(ctx, migrationID)
}

// CheckCompatibility checks if a migration is compatible
func (e *Engine) CheckCompatibility(ctx context.Context, sourceServerID, targetServerID, username string) (*common.CompatibilityResult, error) {
	sourceServer, err := e.db.GetServer(ctx, sourceServerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get source server: %w", err)
	}
	targetServer, err := e.db.GetServer(ctx, targetServerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get target server: %w", err)
	}
	result := &common.CompatibilityResult{Compatible: true, Mappings: make(map[string]string)}
	sourceType := common.PanelType(sourceServer.PanelType)
	targetType := common.PanelType(targetServer.PanelType)

	supportedPaths := map[common.PanelType][]common.PanelType{
		common.PanelTypeDirectAdmin: {common.PanelTypeEnhance},
	}
	supported := false
	for _, target := range supportedPaths[sourceType] {
		if target == targetType {
			supported = true
			break
		}
	}
	if !supported {
		result.Compatible = false
		result.Errors = append(result.Errors, fmt.Sprintf("Migration from %s to %s is not supported", sourceType, targetType))
		return result, nil
	}
	result.Mappings["source_panel"] = string(sourceType)
	result.Mappings["target_panel"] = string(targetType)
	result.Warnings = append(result.Warnings,
		"Mailbox contents are not migrated; mailboxes are recreated with new passwords",
		"Database users get new passwords; wp-config.php is updated automatically, other apps need manual update",
	)
	return result, nil
}

// CreateSSHClient creates an SSH client for a server
func (e *Engine) CreateSSHClient(server *storage.Server, password string) (*ssh.Client, error) {
	config := e.db.ToConnectionConfig(server)
	var privateKey []byte
	if server.SSHKeyID.Valid {
		keyData, _ := e.db.GetSSHKeyPrivateKey(context.Background(), server.SSHKeyID.String)
		privateKey = []byte(keyData)
	}
	client := ssh.NewClient()
	if err := client.Connect(context.Background(), config, password, privateKey); err != nil {
		return nil, err
	}
	return client, nil
}

// AccountInfo represents account information from a server
type AccountInfo struct {
	Username      string   `json:"username"`
	Domain        string   `json:"domain"`
	Email         string   `json:"email"`
	DiskUsed      string   `json:"disk_used"`
	DiskLimit     string   `json:"disk_limit"`
	Suspended     bool     `json:"suspended"`
	PHPVersion    string   `json:"php_version,omitempty"`
	Databases     []string `json:"databases,omitempty"`
	EmailAccounts []string `json:"email_accounts,omitempty"`
	AddonDomains  []string `json:"addon_domains,omitempty"`
	SSLEnabled    bool     `json:"ssl_enabled,omitempty"`
	SSLExpiry     string   `json:"ssl_expiry,omitempty"`
	IsWordPress   bool     `json:"is_wordpress"`
	DBSize        string   `json:"db_size,omitempty"`
}

// ServerInfo represents server system information
type ServerInfo struct {
	WebServer   string `json:"web_server"`
	TotalDisk   string `json:"total_disk"`
	UsedDisk    string `json:"used_disk"`
	OSVersion   string `json:"os_version"`
	PHPVersions string `json:"php_versions"`
}

// GetServerInfo gets system information from a server
func (e *Engine) GetServerInfo(ctx context.Context, server *storage.Server, password string) (*ServerInfo, error) {
	config := e.db.ToConnectionConfig(server)
	var privateKey []byte
	if server.SSHKeyID.Valid {
		keyData, _ := e.db.GetSSHKeyPrivateKey(ctx, server.SSHKeyID.String)
		privateKey = []byte(keyData)
	}
	client := ssh.NewClient()
	if err := client.Connect(ctx, config, password, privateKey); err != nil {
		return nil, err
	}
	defer client.Disconnect()

	info := &ServerInfo{}
	script := `
		if command -v nginx &> /dev/null && systemctl is-active nginx &> /dev/null; then
			echo "Nginx"
		elif command -v lshttpd &> /dev/null || [ -f /usr/local/lsws/bin/lshttpd ]; then
			if [ -f /usr/local/lsws/VERSION ]; then
				echo "LiteSpeed"
			else
				echo "OpenLiteSpeed"
			fi
		elif command -v httpd &> /dev/null || command -v apache2 &> /dev/null; then
			echo "Apache"
		else
			echo "Unknown"
		fi
		echo "---SEP---"
		df -h / 2>/dev/null | tail -1 | awk '{print $2 "," $3 "," $5}'
		echo "---SEP---"
		cat /etc/os-release 2>/dev/null | grep "PRETTY_NAME" | cut -d'"' -f2 || uname -a
		echo "---SEP---"
		ls /usr/local/php*/bin/php 2>/dev/null | xargs -I{} {} -v 2>/dev/null | grep -oP 'PHP [0-9]+\.[0-9]+' | sort -u | tr '\n' ',' || php -v 2>/dev/null | head -1 | grep -oP 'PHP [0-9]+\.[0-9]+'
	`
	output, err := client.RunCommand(ctx, script)
	if err != nil {
		return info, nil
	}
	parts := strings.Split(output, "---SEP---")
	if len(parts) > 0 {
		info.WebServer = strings.TrimSpace(parts[0])
	}
	if len(parts) > 1 {
		diskParts := strings.Split(strings.TrimSpace(parts[1]), ",")
		if len(diskParts) >= 2 {
			info.TotalDisk = diskParts[0]
			info.UsedDisk = diskParts[1]
		}
	}
	if len(parts) > 2 {
		info.OSVersion = strings.TrimSpace(parts[2])
	}
	if len(parts) > 3 {
		info.PHPVersions = strings.TrimSuffix(strings.TrimSpace(parts[3]), ",")
	}
	return info, nil
}

// EnhanceClusterServer represents a server in an Enhance cluster
type EnhanceClusterServer struct {
	ID           string   `json:"id"`
	FriendlyName string   `json:"friendly_name"`
	Hostname     string   `json:"hostname"`
	IP           string   `json:"ip"`
	Role         string   `json:"role"`
	Roles        []string `json:"roles"`
	IsMain       bool     `json:"is_main"`
	Status       string   `json:"status"`
}

// GetEnhanceClusterServers gets all servers in an Enhance cluster
func (e *Engine) GetEnhanceClusterServers(ctx context.Context, server *storage.Server, apiKey string) ([]EnhanceClusterServer, error) {
	config := e.db.ToConnectionConfig(server)
	en := enhance.New()
	if err := en.ConnectAPI(ctx, config, apiKey); err != nil {
		return nil, fmt.Errorf("failed to connect to Enhance: %w", err)
	}
	servers, err := en.ListServers(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]EnhanceClusterServer, 0, len(servers))
	for _, s := range servers {
		if s.IsDecommissioned {
			continue
		}
		roles := s.EnabledRoles()
		status := "configured"
		if !s.IsConfigured {
			status = "not configured"
		}
		result = append(result, EnhanceClusterServer{
			ID:           s.ID,
			FriendlyName: strings.TrimSpace(s.FriendlyName),
			Hostname:     s.Hostname,
			IP:           s.PrimaryIP(),
			Role:         strings.Join(roles, ", "),
			Roles:        roles,
			IsMain:       s.IsControlPanel,
			Status:       status,
		})
	}
	return result, nil
}

// GetServerAccounts gets all accounts from a server
func (e *Engine) GetServerAccounts(ctx context.Context, server *storage.Server, password string) ([]AccountInfo, error) {
	config := e.db.ToConnectionConfig(server)
	var privateKey []byte
	if server.SSHKeyID.Valid {
		keyData, _ := e.db.GetSSHKeyPrivateKey(ctx, server.SSHKeyID.String)
		privateKey = []byte(keyData)
	}

	switch common.PanelType(server.PanelType) {
	case common.PanelTypeDirectAdmin:
		da := directadmin.New()
		if err := da.ConnectWithCredentials(ctx, config, password, privateKey); err != nil {
			return nil, fmt.Errorf("failed to connect to DirectAdmin: %w", err)
		}
		defer da.Disconnect()
		accounts, err := da.ListAccounts(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list accounts: %w", err)
		}
		var result []AccountInfo
		for _, acc := range accounts {
			result = append(result, AccountInfo{
				Username:      acc.Username,
				Domain:        acc.Domain,
				Email:         acc.Email,
				DiskUsed:      acc.DiskUsage,
				DiskLimit:     acc.DiskLimit,
				Suspended:     acc.Suspended,
				PHPVersion:    acc.PHPVersion,
				Databases:     acc.Databases,
				EmailAccounts: acc.EmailAccounts,
				AddonDomains:  acc.AddonDomains,
				SSLEnabled:    acc.SSLEnabled,
				SSLExpiry:     acc.SSLExpiry,
				IsWordPress:   acc.IsWordPress,
				DBSize:        acc.DBSize,
			})
		}
		return result, nil

	case common.PanelTypeEnhance:
		apiKey, _ := e.db.GetServerAPIKey(ctx, server.ID)
		en := enhance.New()
		if err := en.ConnectAPI(ctx, config, apiKey); err != nil {
			return nil, fmt.Errorf("failed to connect to Enhance: %w", err)
		}
		accounts, err := en.ListAccounts(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list accounts: %w", err)
		}
		var result []AccountInfo
		for _, acc := range accounts {
			result = append(result, AccountInfo{
				Username:  acc.Username,
				Domain:    acc.Domain,
				Email:     acc.Email,
				DiskUsed:  acc.DiskUsage,
				DiskLimit: acc.DiskLimit,
				Suspended: acc.Suspended,
			})
		}
		return result, nil

	default:
		return nil, fmt.Errorf("unsupported panel type: %s", server.PanelType)
	}
}
