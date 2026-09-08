// Package migration provides the migration engine
package migration

import (
	"context"
	"encoding/json"
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
	return &Engine{
		db:      db,
		logger:  log,
		workDir: workDir,
	}
}

// MigrationRequest represents a migration request
type MigrationRequest struct {
	SourceServerID string `json:"source_server_id"`
	TargetServerID string `json:"target_server_id"`
	Username       string `json:"username"`
	NewPassword    string `json:"new_password,omitempty"` // Password for new account
}

// MigrationResult represents the result of a migration
type MigrationResult struct {
	ID          string                    `json:"id"`
	Status      string                    `json:"status"`
	ExportData  *common.ExportData        `json:"export_data,omitempty"`
	Error       string                    `json:"error,omitempty"`
	StartedAt   time.Time                 `json:"started_at"`
	CompletedAt *time.Time                `json:"completed_at,omitempty"`
	Progress    *common.MigrationProgress `json:"progress,omitempty"`
}

// StartMigration starts a new migration
func (e *Engine) StartMigration(ctx context.Context, req *MigrationRequest) (*MigrationResult, error) {
	// Create migration record in database first to get the ID
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
		ID:        migrationID,
		Status:    "running",
		StartedAt: time.Now(),
		Progress: &common.MigrationProgress{
			ID:        migrationID,
			Status:    "running",
			StartedAt: time.Now(),
		},
	}

	// Get source and target server configs
	sourceServer, err := e.db.GetServer(ctx, req.SourceServerID)
	if err != nil {
		e.failMigration(ctx, migration.ID, fmt.Sprintf("failed to get source server: %v", err))
		return nil, fmt.Errorf("failed to get source server: %w", err)
	}

	targetServer, err := e.db.GetServer(ctx, req.TargetServerID)
	if err != nil {
		e.failMigration(ctx, migration.ID, fmt.Sprintf("failed to get target server: %v", err))
		return nil, fmt.Errorf("failed to get target server: %w", err)
	}

	// Create work directory for this migration
	migrationDir := filepath.Join(e.workDir, migration.ID)
	if err := os.MkdirAll(migrationDir, 0755); err != nil {
		e.failMigration(ctx, migration.ID, fmt.Sprintf("failed to create work directory: %v", err))
		return nil, fmt.Errorf("failed to create work directory: %w", err)
	}

	// Run migration in background with a new context (not tied to HTTP request)
	bgCtx := context.Background()
	go e.runMigration(bgCtx, migration.ID, sourceServer, targetServer, req, migrationDir)

	return result, nil
}

// runMigration executes the migration process
func (e *Engine) runMigration(ctx context.Context, migrationID string, sourceServer, targetServer *storage.Server, req *MigrationRequest, workDir string) {
	progressChan := make(chan common.MigrationProgress, 100)

	// Progress updater
	go func() {
		for progress := range progressChan {
			progress.ID = migrationID
			e.db.UpdateMigrationProgress(ctx, migrationID, &progress)
			e.db.AddMigrationLog(ctx, migrationID, "info", progress.CurrentStep, nil)
		}
	}()

	defer close(progressChan)

	// Phase 1: Export from source
	e.db.AddMigrationLog(ctx, migrationID, "info", "Starting export from source server", map[string]interface{}{
		"source": sourceServer.Name,
		"panel":  sourceServer.PanelType,
	})

	exportData, err := e.exportFromSource(ctx, sourceServer, req.Username, workDir, progressChan)
	if err != nil {
		e.failMigration(ctx, migrationID, fmt.Sprintf("export failed: %v", err))
		return
	}

	// Save export data to database
	exportJSON, _ := json.Marshal(exportData)
	e.db.AddMigrationLog(ctx, migrationID, "info", "Export completed successfully", map[string]interface{}{
		"domains":   len(exportData.Domains),
		"databases": len(exportData.Databases),
		"emails":    len(exportData.Emails),
	})

	// Phase 2: Import to target
	e.db.AddMigrationLog(ctx, migrationID, "info", "Starting import to target server", map[string]interface{}{
		"target": targetServer.Name,
		"panel":  targetServer.PanelType,
	})

	if err := e.importToTarget(ctx, targetServer, exportData, req.NewPassword, progressChan); err != nil {
		e.failMigration(ctx, migrationID, fmt.Sprintf("import failed: %v", err))
		return
	}

	// Phase 3: Fix permissions on target
	e.db.AddMigrationLog(ctx, migrationID, "info", "Fixing permissions on target server", nil)
	progressChan <- common.MigrationProgress{
		Status:      "running",
		CurrentStep: "Fixing file permissions",
	}

	if err := e.fixPermissionsOnTarget(ctx, targetServer, exportData); err != nil {
		e.db.AddMigrationLog(ctx, migrationID, "warn", fmt.Sprintf("Permission fix warning: %v", err), nil)
	}

	// Phase 4: Cleanup temporary files
	e.db.AddMigrationLog(ctx, migrationID, "info", "Cleaning up temporary files", nil)
	progressChan <- common.MigrationProgress{
		Status:      "running",
		CurrentStep: "Cleaning up temporary files",
	}

	// Cleanup on source server
	if err := e.cleanupSourceServer(ctx, sourceServer, workDir); err != nil {
		e.db.AddMigrationLog(ctx, migrationID, "warn", fmt.Sprintf("Source cleanup warning: %v", err), nil)
	}

	// Cleanup on target server
	if err := e.cleanupTargetServer(ctx, targetServer); err != nil {
		e.db.AddMigrationLog(ctx, migrationID, "warn", fmt.Sprintf("Target cleanup warning: %v", err), nil)
	}

	// Cleanup local work directory
	if err := os.RemoveAll(workDir); err != nil {
		e.db.AddMigrationLog(ctx, migrationID, "warn", fmt.Sprintf("Local cleanup warning: %v", err), nil)
	}

	// Mark as completed
	now := time.Now()
	e.db.UpdateMigrationProgress(ctx, migrationID, &common.MigrationProgress{
		ID:          migrationID,
		Status:      "completed",
		CurrentStep: "Migration completed",
		CompletedAt: &now,
	})

	e.db.AddMigrationLog(ctx, migrationID, "info", "Migration completed successfully", map[string]interface{}{
		"export_data": string(exportJSON),
	})
}

// exportFromSource exports data from the source server
func (e *Engine) exportFromSource(ctx context.Context, server *storage.Server, username, workDir string, progress chan<- common.MigrationProgress) (*common.ExportData, error) {
	config := e.db.ToConnectionConfig(server)

	// Get credentials
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

// importToTarget imports data to the target server
func (e *Engine) importToTarget(ctx context.Context, server *storage.Server, data *common.ExportData, newPassword string, progress chan<- common.MigrationProgress) error {
	config := e.db.ToConnectionConfig(server)

	// Get credentials
	password, _ := e.db.GetServerPassword(ctx, server.ID)
	apiKey, _ := e.db.GetServerAPIKey(ctx, server.ID)
	var privateKey []byte
	if server.SSHKeyID.Valid {
		keyData, _ := e.db.GetSSHKeyPrivateKey(ctx, server.SSHKeyID.String)
		privateKey = []byte(keyData)
	}

	switch common.PanelType(server.PanelType) {
	case common.PanelTypeEnhance:
		en := enhance.New()
		if err := en.ConnectWithCredentials(ctx, config, apiKey, password, privateKey); err != nil {
			return fmt.Errorf("failed to connect to Enhance: %w", err)
		}
		defer en.Disconnect()

		if err := en.TestConnection(ctx); err != nil {
			return fmt.Errorf("Enhance connection test failed: %w", err)
		}

		_, err := en.ImportAccount(ctx, data, newPassword, progress)
		return err

	default:
		return fmt.Errorf("unsupported target panel type: %s", server.PanelType)
	}
}

// fixPermissionsOnTarget fixes file permissions on the target server
func (e *Engine) fixPermissionsOnTarget(ctx context.Context, server *storage.Server, data *common.ExportData) error {
	config := e.db.ToConnectionConfig(server)

	password, _ := e.db.GetServerPassword(ctx, server.ID)
	apiKey, _ := e.db.GetServerAPIKey(ctx, server.ID)
	var privateKey []byte
	if server.SSHKeyID.Valid {
		keyData, _ := e.db.GetSSHKeyPrivateKey(ctx, server.SSHKeyID.String)
		privateKey = []byte(keyData)
	}

	switch common.PanelType(server.PanelType) {
	case common.PanelTypeEnhance:
		en := enhance.New()
		if err := en.ConnectWithCredentials(ctx, config, apiKey, password, privateKey); err != nil {
			return fmt.Errorf("failed to connect to Enhance: %w", err)
		}
		defer en.Disconnect()

		// Get website info to find the correct path and user
		for _, domain := range data.Domains {
			// The website path is typically /home/<unixuser>/public_html or similar
			// We need to get the actual path from Enhance
			websitePath := fmt.Sprintf("/home/%s/public_html", data.Account.Username)
			unixUser := data.Account.Username

			if err := en.FixPermissions(ctx, websitePath, unixUser); err != nil {
				fmt.Printf("Warning: failed to fix permissions for %s: %v\n", domain.Name, err)
			}
		}
		return nil

	default:
		return fmt.Errorf("permission fix not implemented for panel type: %s", server.PanelType)
	}
}

// cleanupSourceServer removes temporary files from the source server
func (e *Engine) cleanupSourceServer(ctx context.Context, server *storage.Server, workDir string) error {
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

		// Cleanup paths - SQL dumps, ZIP files, etc.
		cleanupPaths := []string{
			"/tmp/migration_*",
			"/tmp/*.sql",
			"/tmp/*_backup.tar.gz",
		}

		return da.CleanupTempFiles(ctx, cleanupPaths)

	default:
		return nil // No cleanup needed for other panel types
	}
}

// cleanupTargetServer removes temporary files from the target server
func (e *Engine) cleanupTargetServer(ctx context.Context, server *storage.Server) error {
	config := e.db.ToConnectionConfig(server)

	password, _ := e.db.GetServerPassword(ctx, server.ID)
	apiKey, _ := e.db.GetServerAPIKey(ctx, server.ID)
	var privateKey []byte
	if server.SSHKeyID.Valid {
		keyData, _ := e.db.GetSSHKeyPrivateKey(ctx, server.SSHKeyID.String)
		privateKey = []byte(keyData)
	}

	switch common.PanelType(server.PanelType) {
	case common.PanelTypeEnhance:
		en := enhance.New()
		if err := en.ConnectWithCredentials(ctx, config, apiKey, password, privateKey); err != nil {
			return fmt.Errorf("failed to connect to Enhance: %w", err)
		}
		defer en.Disconnect()

		// Cleanup paths - SQL dumps, ZIP files, etc.
		cleanupPaths := []string{
			"/tmp/migration_*",
			"/tmp/*.sql",
			"/tmp/*_backup.tar.gz",
			"/tmp/*_import",
		}

		return en.CleanupTempFiles(ctx, cleanupPaths)

	default:
		return nil // No cleanup needed for other panel types
	}
}

// failMigration marks a migration as failed
func (e *Engine) failMigration(ctx context.Context, migrationID, errorMsg string) {
	now := time.Now()
	e.db.UpdateMigrationProgress(ctx, migrationID, &common.MigrationProgress{
		ID:          migrationID,
		Status:      "failed",
		Error:       errorMsg,
		CompletedAt: &now,
	})
	e.db.AddMigrationLog(ctx, migrationID, "error", errorMsg, nil)
}

// GetMigrationStatus gets the current status of a migration
func (e *Engine) GetMigrationStatus(ctx context.Context, migrationID string) (*MigrationResult, error) {
	migration, err := e.db.GetMigration(ctx, migrationID)
	if err != nil {
		return nil, err
	}

	result := &MigrationResult{
		ID:        migration.ID,
		Status:    migration.Status,
		StartedAt: migration.StartedAt.Time,
	}

	if migration.CompletedAt.Valid {
		result.CompletedAt = &migration.CompletedAt.Time
	}

	if migration.ErrorMessage.Valid {
		result.Error = migration.ErrorMessage.String
	}

	result.Progress = &common.MigrationProgress{
		ID:               migration.ID,
		Status:           migration.Status,
		CurrentStep:      migration.CurrentStep.String,
		TotalSteps:       migration.TotalSteps,
		CompletedSteps:   migration.CompletedSteps,
		BytesTransferred: migration.BytesTransferred,
		TotalBytes:       migration.TotalBytes,
		StartedAt:        migration.StartedAt.Time,
	}

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

	var results []*MigrationResult
	for _, m := range migrations {
		result := &MigrationResult{
			ID:        m.ID,
			Status:    m.Status,
			StartedAt: m.StartedAt.Time,
		}
		if m.CompletedAt.Valid {
			result.CompletedAt = &m.CompletedAt.Time
		}
		if m.ErrorMessage.Valid {
			result.Error = m.ErrorMessage.String
		}
		results = append(results, result)
	}

	return results, nil
}

// GetMigrationLogs gets logs for a migration
func (e *Engine) GetMigrationLogs(ctx context.Context, migrationID string) ([]storage.MigrationLog, error) {
	return e.db.GetMigrationLogs(ctx, migrationID)
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

	result := &common.CompatibilityResult{
		Compatible: true,
		Mappings:   make(map[string]string),
	}

	// Check panel compatibility
	sourceType := common.PanelType(sourceServer.PanelType)
	targetType := common.PanelType(targetServer.PanelType)

	// Define supported migration paths
	supportedPaths := map[common.PanelType][]common.PanelType{
		common.PanelTypeDirectAdmin: {common.PanelTypeEnhance, common.PanelTypeCPanel},
		common.PanelTypeCPanel:      {common.PanelTypeEnhance, common.PanelTypeDirectAdmin},
		common.PanelTypeEnhance:     {common.PanelTypeDirectAdmin, common.PanelTypeCPanel},
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
		result.Errors = append(result.Errors,
			fmt.Sprintf("Migration from %s to %s is not supported", sourceType, targetType))
		return result, nil
	}

	result.Mappings["source_panel"] = string(sourceType)
	result.Mappings["target_panel"] = string(targetType)

	// Add warnings for potential issues
	if sourceType == common.PanelTypeDirectAdmin && targetType == common.PanelTypeEnhance {
		result.Warnings = append(result.Warnings,
			"Some DirectAdmin-specific features may not be available in Enhance",
			"Custom Apache configurations will need manual review",
		)
	}

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

	// Detect web server
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
		# Disk usage
		df -h / 2>/dev/null | tail -1 | awk '{print $2 "," $3 "," $5}'
		echo "---SEP---"
		# OS Version
		cat /etc/os-release 2>/dev/null | grep "PRETTY_NAME" | cut -d'"' -f2 || uname -a
		echo "---SEP---"
		# PHP versions available
		ls /usr/local/php*/bin/php 2>/dev/null | xargs -I{} {} -v 2>/dev/null | grep -oP 'PHP [0-9]+\.[0-9]+' | sort -u | tr '\n' ',' || php -v 2>/dev/null | head -1 | grep -oP 'PHP [0-9]+\.[0-9]+'
	`

	output, err := client.RunCommand(ctx, script)
	if err != nil {
		return info, nil // Return empty info on error
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

// EnhanceClusterServer represents a server in Enhance cluster
type EnhanceClusterServer struct {
	ID           string `json:"id"`
	FriendlyName string `json:"friendly_name"`
	Hostname     string `json:"hostname"`
	IP           string `json:"ip"`
	Role         string `json:"role"`
	IsMain       bool   `json:"is_main"`
	Status       string `json:"status"`
}

// GetEnhanceClusterServers gets all servers in an Enhance cluster
func (e *Engine) GetEnhanceClusterServers(ctx context.Context, server *storage.Server, apiKey string) ([]EnhanceClusterServer, error) {
	config := e.db.ToConnectionConfig(server)

	var privateKey []byte
	if server.SSHKeyID.Valid {
		keyData, _ := e.db.GetSSHKeyPrivateKey(ctx, server.SSHKeyID.String)
		privateKey = []byte(keyData)
	}

	// Get password for SSH
	password, _ := e.db.GetDecryptedPassword(ctx, server.ID)

	en := enhance.New()
	if err := en.ConnectWithCredentials(ctx, config, apiKey, password, privateKey); err != nil {
		return nil, fmt.Errorf("failed to connect to Enhance: %w", err)
	}
	defer en.Disconnect()

	servers, err := en.ListServers(ctx)
	if err != nil {
		return nil, err
	}

	var result []EnhanceClusterServer
	for _, s := range servers {
		result = append(result, EnhanceClusterServer{
			ID:           s.ID,
			FriendlyName: s.FriendlyName,
			Hostname:     s.Hostname,
			IP:           s.IP,
			Role:         s.Role,
			IsMain:       s.IsMain,
			Status:       s.Status,
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
			info := AccountInfo{
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
			}
			result = append(result, info)
		}
		return result, nil

	case common.PanelTypeEnhance:
		// Enhance uses API, not SSH
		apiKey, _ := e.db.GetServerAPIKey(ctx, server.ID)
		en := enhance.New()
		if err := en.ConnectWithCredentials(ctx, config, apiKey, password, privateKey); err != nil {
			return nil, fmt.Errorf("failed to connect to Enhance: %w", err)
		}

		accounts, err := en.ListAccounts(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list accounts: %w", err)
		}

		var result []AccountInfo
		for _, acc := range accounts {
			info := AccountInfo{
				Username:  acc.Username,
				Domain:    acc.Domain,
				Email:     acc.Email,
				DiskUsed:  acc.DiskUsage,
				DiskLimit: acc.DiskLimit,
				Suspended: acc.Suspended,
			}
			result = append(result, info)
		}
		return result, nil

	default:
		return nil, fmt.Errorf("unsupported panel type: %s", server.PanelType)
	}
}
