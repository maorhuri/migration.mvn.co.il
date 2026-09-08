// Package migration provides the migration engine
package migration

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
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
	migrationID := uuid.New().String()

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

	// Create migration record in database
	migration := &storage.Migration{
		SourceServerID:  req.SourceServerID,
		TargetServerID:  req.TargetServerID,
		AccountUsername: req.Username,
	}
	if err := e.db.CreateMigration(ctx, migration); err != nil {
		return nil, fmt.Errorf("failed to create migration record: %w", err)
	}
	result.ID = migration.ID

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

	// Run migration in background
	go e.runMigration(ctx, migration.ID, sourceServer, targetServer, req, migrationDir)

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

	if migration.ExportData != nil {
		var exportData common.ExportData
		if err := json.Unmarshal(migration.ExportData, &exportData); err == nil {
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
