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
	"sync"
	"time"

	"github.com/migration-tool/backend/internal/panels/agentless"
	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/panels/directadmin"
	"github.com/migration-tool/backend/internal/panels/enhance"
	"github.com/migration-tool/backend/internal/security"
	"github.com/migration-tool/backend/internal/ssh"
	"github.com/migration-tool/backend/internal/storage"
	"github.com/migration-tool/backend/pkg/logger"
)

// Engine handles migration operations
type Engine struct {
	db      *storage.Database
	logger  *logger.Logger
	workDir string

	mu        sync.Mutex
	cancels   map[string]context.CancelFunc // live workers by migration id
	decisions map[string]chan string        // scan-review decisions for workers waiting on the operator
}

// NewEngine creates a new migration engine
func NewEngine(db *storage.Database, log *logger.Logger, workDir string) *Engine {
	return &Engine{db: db, logger: log, workDir: workDir, cancels: map[string]context.CancelFunc{}, decisions: map[string]chan string{}}
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
	ScanMalware           bool   `json:"scan_malware"`           // scan the staged export for malware before importing
}

// MigrationResult represents the state of a migration as exposed by the API
type MigrationResult struct {
	ID                string                    `json:"id"`
	SourceServerID    string                    `json:"source_server_id"`
	TargetServerID    string                    `json:"target_server_id"`
	AccountUsername   string                    `json:"account_username"`
	Status            string                    `json:"status"`
	CurrentStep       string                    `json:"current_step,omitempty"`
	TotalSteps        int                       `json:"total_steps"`
	CompletedSteps    int                       `json:"completed_steps"`
	TargetIP          string                    `json:"target_ip,omitempty"`
	TargetNode        string                    `json:"target_node,omitempty"`
	Warnings          int                       `json:"warnings"`
	ExportData        *common.ExportData        `json:"export_data,omitempty"`
	Error             string                    `json:"error,omitempty"`
	CreatedAt         time.Time                 `json:"created_at"`
	StartedAt         time.Time                 `json:"started_at"`
	CompletedAt       *time.Time                `json:"completed_at,omitempty"`
	SourceSuspendedAt *time.Time                `json:"source_suspended_at,omitempty"` // source account suspended after migration
	ScanRequested     bool                      `json:"scan_requested"`
	ScanReport        *security.Report          `json:"scan_report,omitempty"`
	ScanDecision      string                    `json:"scan_decision,omitempty"`
	Progress          *common.MigrationProgress `json:"progress,omitempty"`
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
	if req.ScanMalware {
		e.db.SetMigrationScanRequested(ctx, migrationID, true)
	}
	if req.TargetClusterServerID != "" {
		e.db.SetMigrationClusterServer(ctx, migrationID, req.TargetClusterServerID)
	}

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
	consumerDone := make(chan struct{})
	lastTotalSteps := 0
	go func() {
		defer close(consumerDone)
		for progress := range progressChan {
			progress.ID = migrationID
			if progress.TotalSteps > 0 {
				lastTotalSteps = progress.TotalSteps
			}
			e.db.UpdateMigrationProgress(ctx, migrationID, &progress)
			if !progress.Logged {
				e.db.AddMigrationLog(ctx, migrationID, "info", progress.CurrentStep, nil)
			}
		}
	}()
	// drain closes the progress channel and waits until every queued progress update has been
	// written, so a final "completed"/"failed" status can never be overwritten by a stale "running".
	var drainOnce sync.Once
	drain := func() { drainOnce.Do(func() { close(progressChan); <-consumerDone }) }
	defer drain()
	// workCtx is cancelled by CancelMigration; DB writes keep using ctx so the final status is always recorded.
	workCtx, cancelWork := context.WithCancel(ctx)
	e.mu.Lock()
	e.cancels[migrationID] = cancelWork
	e.mu.Unlock()
	defer func() {
		cancelWork()
		e.mu.Lock()
		delete(e.cancels, migrationID)
		e.mu.Unlock()
	}()
	fail := func(msg string) {
		drain()
		if workCtx.Err() != nil {
			e.cancelMigrationRecord(ctx, migrationID, msg)
			return
		}
		e.failMigration(ctx, migrationID, msg)
	}

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
	exportData, err := e.exportFromSource(workCtx, sourceServer, req.Username, workDir, progressChan, migrationLog)
	if err != nil {
		fail(fmt.Sprintf("export failed: %v", err))
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
		fail(fmt.Sprintf("export found no database dumps although the account has databases (%s)", strings.Join(exportData.Account.Databases, ", ")))
		return
	}

	// Phase 1b: optional malware scan on the staging copy, with an operator decision when something is found
	if req.ScanMalware {
		progressChan <- common.MigrationProgress{Status: "running", CurrentStep: "Scanning for malware"}
		report, err := security.Scan(workCtx, exportData, security.Options{
			CacheDir: filepath.Join(e.workDir, ".cache"),
			Log:      migrationLog,
		})
		if err != nil {
			fail(fmt.Sprintf("malware scan failed: %v", err))
			return
		}
		storeReport := func() {
			if enc, err := json.Marshal(report); err == nil {
				e.db.SetMigrationScanReport(ctx, migrationID, enc)
			}
		}
		storeReport()
		migrationLog("info", "Malware scan: "+report.Summary()+"; ClamAV: "+report.ClamAV)
		for _, f := range report.Findings {
			level := "warn"
			if f.Severity == security.SevInfo {
				level = "info"
			}
			migrationLog(level, fmt.Sprintf("[%s] %s %s: %s", strings.ToUpper(string(f.Severity)), f.Category, f.Path, f.Evidence))
		}
		if report.NeedsReview() {
			progressChan <- common.MigrationProgress{Status: "awaiting_review", CurrentStep: "Waiting for malware scan review"}
			migrationLog("warn", fmt.Sprintf("Waiting for your decision: %d finding(s), %d can be cleaned automatically (quarantined on the staging server, core files restored from wordpress.org)", len(report.Findings), report.Cleanable))
			decision, ok := e.waitScanDecision(workCtx, migrationID, 4*time.Hour)
			if !ok {
				if workCtx.Err() != nil {
					fail("cancelled while waiting for the malware scan review")
				} else {
					fail("no decision on the malware scan findings within 4 hours")
				}
				return
			}
			e.db.SetMigrationScanDecision(ctx, migrationID, decision)
			switch decision {
			case "clean":
				progressChan <- common.MigrationProgress{Status: "running", CurrentStep: "Cleaning malware findings"}
				res := security.Clean(workCtx, exportData, report, security.Options{CacheDir: filepath.Join(e.workDir, ".cache"), Log: migrationLog})
				storeReport()
				migrationLog("info", fmt.Sprintf("Cleanup: %d quarantined, %d core file(s) restored, %d config file(s) stripped, %d skipped, %d error(s); quarantine kept at %s on the staging server",
					len(res.Quarantined), len(res.Restored), len(res.LinesRemoved), len(res.Skipped), len(res.Errors), res.QuarantineDir))
				for _, e := range res.Errors {
					warn("Cleanup error: %s", e)
				}
				remaining := 0
				for _, f := range report.Findings {
					if !f.Cleaned && f.Severity != security.SevInfo {
						remaining++
					}
				}
				if remaining > 0 {
					warn("%d finding(s) need manual review after import (database items and report-only files)", remaining)
				}
			case "skip":
				warn("Malware findings were NOT cleaned (operator chose to continue); %d finding(s) will be uploaded as-is", len(report.Findings))
			default: // abort
				e.cancelMigrationRecord(ctx, migrationID, "aborted after the malware scan")
				return
			}
			progressChan <- common.MigrationProgress{Status: "running", CurrentStep: "Malware scan reviewed"}
		} else {
			migrationLog("info", "Malware scan: nothing suspicious found")
		}
	}

	// Phase 2: import
	switch common.PanelType(targetServer.PanelType) {
	case common.PanelTypeEnhance:
		progressChan <- common.MigrationProgress{Status: "running", CurrentStep: "Connecting to cluster node"}
		en, err := e.connectEnhanceTarget(workCtx, migrationID, targetServer, req.TargetClusterServerID, migrationLog)
		if err != nil {
			fail(fmt.Sprintf("import failed: %v", err))
			return
		}
		defer en.Disconnect()
		defer func() { // also on failure/cancel: never leave dumps in /tmp on the node
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			defer cancel()
			en.CleanupTempFiles(cleanupCtx)
		}()

		result, err := en.ImportAccount(workCtx, exportData, progressChan)
		warnings += len(en.Warnings())
		e.db.SetMigrationWarnings(ctx, migrationID, warnings)
		if err != nil {
			fail(fmt.Sprintf("import failed: %v", err))
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
		fail(fmt.Sprintf("unsupported target panel type: %s", targetServer.PanelType))
		return
	}

	if err := e.cleanupSourceServer(ctx, sourceServer); err != nil {
		warn("Source cleanup warning: %v", err)
	}

	drain()
	now := time.Now()
	e.db.UpdateMigrationProgress(ctx, migrationID, &common.MigrationProgress{
		ID: migrationID, Status: "completed", CurrentStep: "Migration completed",
		TotalSteps: lastTotalSteps, CompletedSteps: lastTotalSteps, CompletedAt: &now,
	})
	e.db.SetMigrationWarnings(ctx, migrationID, warnings)
	if warnings > 0 {
		migrationLog("info", fmt.Sprintf("Migration completed with %d warning(s); review them before switching DNS", warnings))
	} else {
		migrationLog("info", "Migration completed successfully")
	}
	e.refreshAccountsCacheAsync(sourceServer.ID)
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
	if err := en.ResolveOrgForServer(ctx, clusterServerID); err != nil {
		logFn("warn", fmt.Sprintf("Could not check which customer org this node belongs to (%v); using the configured org", err))
	}

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
	switch common.PanelType(server.PanelType) {
	case common.PanelTypeDirectAdmin:
		da, err := e.connectDirectAdmin(ctx, server, "", logFn)
		if err != nil {
			return nil, err
		}
		defer da.Disconnect()
		if err := da.TestConnection(ctx); err != nil {
			return nil, fmt.Errorf("DirectAdmin connection test failed: %w", err)
		}
		return da.ExportAccount(ctx, username, workDir, progress)
	case common.PanelTypeFTP, common.PanelTypeWordPress:
		password, _ := e.db.GetServerPassword(ctx, server.ID)
		return agentless.Export(ctx, server, password, workDir, progress, logFn)
	default:
		return nil, fmt.Errorf("unsupported source panel type: %s", server.PanelType)
	}
}

// SetSourceSuspended suspends or unsuspends the migrated account on the SOURCE panel. It is a manual
// post-migration step (after the DNS/IP switch) and is only allowed for completed migrations.
func (e *Engine) SetSourceSuspended(ctx context.Context, migrationID string, suspend bool) (*MigrationResult, error) {
	m, err := e.db.GetMigration(ctx, migrationID)
	if err != nil {
		return nil, fmt.Errorf("migration not found: %w", err)
	}
	if m.Status != "completed" {
		return nil, fmt.Errorf("only completed migrations can suspend their source account (status: %s)", m.Status)
	}
	server, err := e.db.GetServer(ctx, m.SourceServerID)
	if err != nil {
		return nil, fmt.Errorf("source server not found: %w", err)
	}
	if agentless.IsAgentless(server.PanelType) {
		return nil, fmt.Errorf("%s source %s has no panel to suspend; disable the old site manually (for example rename index.php or point the old vhost to a holding page) after the DNS switch", server.PanelType, server.Name)
	}
	if common.PanelType(server.PanelType) != common.PanelTypeDirectAdmin {
		return nil, fmt.Errorf("source panel %s does not support suspending accounts", server.PanelType)
	}
	action := "unsuspend"
	if suspend {
		action = "suspend"
	}
	logFn := func(level, message string) { e.db.AddMigrationLog(ctx, migrationID, level, message, nil) }

	da, err := e.connectDirectAdmin(ctx, server, "", logFn)
	if err != nil {
		logFn("error", fmt.Sprintf("Source account %s: %s failed: cannot connect to %s: %v", m.AccountUsername, action, server.Name, err))
		return nil, err
	}
	defer da.Disconnect()

	changed, err := da.SetAccountSuspended(ctx, m.AccountUsername, suspend)
	if err != nil {
		logFn("error", fmt.Sprintf("Source account %s: %s on %s failed: %v", m.AccountUsername, action, server.Name, err))
		return nil, err
	}
	if err := e.db.SetMigrationSourceSuspended(ctx, migrationID, suspend); err != nil {
		return nil, fmt.Errorf("account %sed but the migration record could not be updated: %w", action, err)
	}
	e.refreshAccountsCacheAsync(m.SourceServerID)
	switch {
	case !changed:
		// state already matched; SetAccountSuspended logged it
	case suspend:
		logFn("info", fmt.Sprintf("Source account %s suspended on %s (%s); the site is now served only by the new server", m.AccountUsername, server.Name, server.Host))
	default:
		logFn("info", fmt.Sprintf("Source account %s unsuspended on %s (%s)", m.AccountUsername, server.Name, server.Host))
	}
	return e.GetMigrationStatus(ctx, migrationID)
}

// connectDirectAdmin connects to a DirectAdmin server with its configured credentials and, when
// those are refused, falls back to the other stored credential (key -> password, password -> key),
// logging what happened and how to install the tool's key on that server.
func (e *Engine) connectDirectAdmin(ctx context.Context, server *storage.Server, password string, logFn func(level, message string)) (*directadmin.DirectAdmin, error) {
	if logFn == nil {
		logFn = func(string, string) {}
	}
	config := e.db.ToConnectionConfig(server)
	if password == "" {
		password, _ = e.db.GetServerPassword(ctx, server.ID)
	}
	var privateKey []byte
	keyName, publicKey := "", ""
	if server.SSHKeyID.Valid {
		keyData, _ := e.db.GetSSHKeyPrivateKey(ctx, server.SSHKeyID.String)
		privateKey = []byte(keyData)
		if k, err := e.db.GetSSHKey(ctx, server.SSHKeyID.String); err == nil {
			keyName, publicKey = k.Name, strings.TrimSpace(k.PublicKey)
		}
	}
	hint := ""
	if publicKey != "" {
		hint = fmt.Sprintf(" To let the key %q in, run on %s: mkdir -p ~/.ssh && echo '%s' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys", keyName, server.Host, publicKey)
	}

	try := func(method common.AuthMethod, pw string, key []byte) (*directadmin.DirectAdmin, error) {
		cfg := *config
		cfg.AuthMethod = method
		da := directadmin.New()
		da.SetLogger(logFn)
		if err := da.ConnectWithCredentials(ctx, &cfg, pw, key); err != nil {
			return nil, err
		}
		return da, nil
	}

	da, err := try(config.AuthMethod, password, privateKey)
	if err == nil {
		return da, nil
	}
	switch {
	case config.AuthMethod == common.AuthMethodSSHKey && password != "":
		if da2, err2 := try(common.AuthMethodPassword, password, nil); err2 == nil {
			logFn("warn", fmt.Sprintf("SSH key %q was refused by %s (%v); connected with the stored password instead.%s", keyName, server.Host, shortErr(err), hint))
			return da2, nil
		}
	case config.AuthMethod == common.AuthMethodPassword && len(privateKey) > 0:
		if da2, err2 := try(common.AuthMethodSSHKey, "", privateKey); err2 == nil {
			logFn("warn", fmt.Sprintf("Password was refused by %s (%v); connected with SSH key %q instead. Update the server record.", server.Host, shortErr(err), keyName))
			return da2, nil
		}
	}
	if config.AuthMethod == common.AuthMethodSSHKey {
		return nil, fmt.Errorf("SSH key %q not accepted by %s:%d and no working password stored: %w.%s", keyName, server.Host, server.Port, err, hint)
	}
	return nil, fmt.Errorf("failed to connect to DirectAdmin %s:%d: %w", server.Host, server.Port, err)
}

func shortErr(err error) string {
	msg := err.Error()
	if i := strings.Index(msg, "ssh: handshake failed: "); i >= 0 {
		msg = msg[i+len("ssh: handshake failed: "):]
	}
	if len(msg) > 120 {
		msg = msg[:120] + "..."
	}
	return msg
}

// cleanupSourceServer removes temporary files from the source server
func (e *Engine) cleanupSourceServer(ctx context.Context, server *storage.Server) error {
	switch common.PanelType(server.PanelType) {
	case common.PanelTypeDirectAdmin:
		da, err := e.connectDirectAdmin(ctx, server, "", nil)
		if err != nil {
			return err
		}
		defer da.Disconnect()
		return da.CleanupTempFiles(ctx, []string{"/tmp/migration_*"})
	default:
		return nil
	}
}

// failMigration marks a migration as failed
func (e *Engine) failMigration(ctx context.Context, migrationID, errorMsg string) {
	errorMsg = capText(errorMsg, 2000, 3500)
	now := time.Now()
	e.db.UpdateMigrationProgress(ctx, migrationID, &common.MigrationProgress{
		ID: migrationID, Status: "failed", Error: errorMsg, CompletedAt: &now,
	})
	e.db.AddMigrationLog(ctx, migrationID, "error", errorMsg, nil)
}

// capText keeps the first head and last tail characters of a long text.
func capText(s string, head, tail int) string {
	if len(s) <= head+tail+80 {
		return s
	}
	if tail == 0 {
		return s[:head] + " ..."
	}
	return s[:head] + fmt.Sprintf("\n... [%d characters omitted] ...\n", len(s)-head-tail) + s[len(s)-tail:]
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
	if m.SourceSuspendedAt.Valid {
		result.SourceSuspendedAt = &m.SourceSuspendedAt.Time
	}
	result.ScanRequested = m.ScanRequested
	result.ScanDecision = m.ScanDecision.String
	if m.ScanReport.Valid && len(m.ScanReport.Data) > 0 {
		var rep security.Report
		if json.Unmarshal(m.ScanReport.Data, &rep) == nil {
			result.ScanReport = &rep
		}
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
		r := toResult(&migrations[i])
		r.Error = capText(r.Error, 500, 0) // the list is polled every few seconds; the detail page has the full text
		results = append(results, r)
	}
	return results, nil
}

// GetMigrationLogs gets logs for a migration
func (e *Engine) GetMigrationLogs(ctx context.Context, migrationID string) ([]storage.MigrationLog, error) {
	return e.db.GetMigrationLogs(ctx, migrationID)
}

// GetMigrationLogsPage returns the last `limit` lines, or the lines after a timestamp.
func (e *Engine) GetMigrationLogsPage(ctx context.Context, migrationID, after string, limit int) ([]storage.MigrationLog, int, error) {
	logs, total, err := e.db.GetMigrationLogsPage(ctx, migrationID, after, limit)
	for i := range logs {
		logs[i].Message = capText(logs[i].Message, 3000, 2000) // old rows may still carry huge command output
	}
	return logs, total, err
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
	e.mu.Lock()
	cancel, live := e.cancels[migrationID]
	e.mu.Unlock()
	if live {
		// The worker aborts its current command and records the cancelled status itself.
		e.db.AddMigrationLog(ctx, migrationID, "warn", "Cancellation requested by user; aborting the current step", nil)
		cancel()
		return nil
	}
	// No live worker (e.g. the service restarted): mark the record directly.
	e.cancelMigrationRecord(ctx, migrationID, "no running worker")
	return nil
}

// waitScanDecision blocks until the operator submits a decision for the scan findings.
func (e *Engine) waitScanDecision(ctx context.Context, migrationID string, timeout time.Duration) (string, bool) {
	ch := make(chan string, 1)
	e.mu.Lock()
	e.decisions[migrationID] = ch
	e.mu.Unlock()
	defer func() {
		e.mu.Lock()
		delete(e.decisions, migrationID)
		e.mu.Unlock()
	}()
	select {
	case d := <-ch:
		return d, true
	case <-ctx.Done():
		return "", false
	case <-time.After(timeout):
		return "", false
	}
}

// SubmitScanDecision hands the operator's choice (clean, skip, abort) to the waiting worker.
func (e *Engine) SubmitScanDecision(ctx context.Context, migrationID, decision string) (*MigrationResult, error) {
	switch decision {
	case "clean", "skip", "abort":
	default:
		return nil, fmt.Errorf("decision must be clean, skip or abort")
	}
	m, err := e.db.GetMigration(ctx, migrationID)
	if err != nil {
		return nil, fmt.Errorf("migration not found: %w", err)
	}
	if m.Status != "awaiting_review" {
		return nil, fmt.Errorf("migration is not waiting for a scan review (status: %s)", m.Status)
	}
	e.mu.Lock()
	ch, ok := e.decisions[migrationID]
	e.mu.Unlock()
	if !ok {
		e.cancelMigrationRecord(ctx, migrationID, "the worker that scanned this export is gone (service restarted); start the migration again")
		return nil, fmt.Errorf("the scan worker is no longer running; start the migration again")
	}
	select {
	case ch <- decision:
	default:
		return nil, fmt.Errorf("a decision was already submitted")
	}
	e.db.AddMigrationLog(ctx, migrationID, "info", "Operator decision on malware findings: "+decision, nil)
	return e.GetMigrationStatus(ctx, migrationID)
}

// RecoverInterrupted marks migrations that were in flight when the service last stopped
// (deploy, restart, crash) as failed: their workers live only in memory. Returns the count.
func (e *Engine) RecoverInterrupted(ctx context.Context) int {
	rows, err := e.db.ListMigrations(ctx)
	if err != nil {
		return 0
	}
	n := 0
	for i := range rows {
		m := &rows[i]
		if m.Status != "running" && m.Status != "pending" && m.Status != "awaiting_review" {
			continue
		}
		step := m.CurrentStep.String
		if step == "" {
			step = "unknown step"
		}
		msg := fmt.Sprintf("Interrupted by a service restart (deployment) during \"%s\". Nothing was rolled back: use Run again; the website on the node is reused and files already copied are skipped.", step)
		e.failMigration(ctx, m.ID, msg)
		n++
	}
	return n
}

// RerunMigration starts a new migration with the same source, target, node and options as a
// failed or cancelled one.
func (e *Engine) RerunMigration(ctx context.Context, migrationID string) (*MigrationResult, error) {
	m, err := e.db.GetMigration(ctx, migrationID)
	if err != nil {
		return nil, fmt.Errorf("migration not found: %w", err)
	}
	if m.Status != "failed" && m.Status != "cancelled" {
		return nil, fmt.Errorf("only failed or cancelled migrations can be run again (status: %s)", m.Status)
	}
	req := &MigrationRequest{
		SourceServerID:        m.SourceServerID,
		TargetServerID:        m.TargetServerID,
		TargetClusterServerID: m.TargetClusterServerID.String,
		Username:              m.AccountUsername,
		ScanMalware:           m.ScanRequested,
	}
	if req.TargetClusterServerID == "" {
		// Older rows did not record the node: reuse the node of the website if it already exists.
		if target, err := e.db.GetServer(ctx, m.TargetServerID); err == nil && common.PanelType(target.PanelType) == common.PanelTypeEnhance {
			domain := ""
			if accounts, err := e.db.GetServerAccounts(ctx, m.SourceServerID); err == nil {
				for _, a := range accounts {
					if a.Username == m.AccountUsername {
						domain = a.Domain
					}
				}
			}
			if domain != "" {
				apiKey, _ := e.db.GetServerAPIKey(ctx, target.ID)
				probe := enhance.New()
				if err := probe.ConnectAPI(ctx, e.db.ToConnectionConfig(target), apiKey); err == nil {
					if site, err := probe.FindWebsite(ctx, domain); err == nil && site.AppServerID != "" {
						req.TargetClusterServerID = site.AppServerID
					}
				}
			}
		}
		if req.TargetClusterServerID == "" {
			return nil, fmt.Errorf("this migration did not record its cluster node; start it again from New migration and pick the node")
		}
	}
	e.db.AddMigrationLog(ctx, migrationID, "info", "Run again requested; a new migration was started", nil)
	return e.StartMigration(ctx, req)
}

// RepairWordPress re-runs the WordPress registration, PHP version and ownership steps for a
// completed migration (operator action from the migration page).
func (e *Engine) RepairWordPress(ctx context.Context, migrationID string) (*MigrationResult, []string, error) {
	m, err := e.db.GetMigration(ctx, migrationID)
	if err != nil {
		return nil, nil, fmt.Errorf("migration not found: %w", err)
	}
	if m.Status != "completed" {
		return nil, nil, fmt.Errorf("only completed migrations can be repaired (status: %s)", m.Status)
	}
	targetServer, err := e.db.GetServer(ctx, m.TargetServerID)
	if err != nil {
		return nil, nil, fmt.Errorf("target server not found: %w", err)
	}
	if common.PanelType(targetServer.PanelType) != common.PanelTypeEnhance {
		return nil, nil, fmt.Errorf("repair is only implemented for Enhance targets")
	}
	var export common.ExportData
	if m.ExportData.Valid && len(m.ExportData.Data) > 0 {
		_ = json.Unmarshal(m.ExportData.Data, &export)
	}
	var domains []string
	for _, d := range export.Domains {
		domains = append(domains, d.Name)
	}
	if len(domains) == 0 && export.Account.Domain != "" {
		domains = []string{export.Account.Domain}
	}
	if len(domains) == 0 {
		return nil, nil, fmt.Errorf("no domains are recorded for this migration")
	}
	var knownDBs []string
	for _, db := range export.Databases {
		knownDBs = append(knownDBs, db.Name)
	}
	sourcePHP := ""
	if accounts, err := e.db.GetServerAccounts(ctx, m.SourceServerID); err == nil {
		for _, a := range accounts {
			if a.Username == m.AccountUsername && a.PHPVersion.Valid && a.PHPVersion.String != "" {
				sourcePHP = a.PHPVersion.String
			}
		}
	}

	logFn := func(level, message string) { e.db.AddMigrationLog(ctx, migrationID, level, message, nil) }
	logFn("info", fmt.Sprintf("Repair WordPress started (operator action): domains %s, source PHP %q", strings.Join(domains, ", "), sourcePHP))

	// The cluster node is learned from the website itself (the migration record does not store it).
	probe := enhance.New()
	probe.SetLogger(logFn)
	if err := probe.ConnectAPI(ctx, e.db.ToConnectionConfig(targetServer), func() string { k, _ := e.db.GetServerAPIKey(ctx, targetServer.ID); return k }()); err != nil {
		logFn("error", "Repair failed: "+err.Error())
		return nil, nil, err
	}
	site, err := probe.FindWebsite(ctx, domains[0])
	if err != nil {
		logFn("error", "Repair failed: "+err.Error())
		return nil, nil, err
	}
	en, err := e.connectEnhanceTarget(ctx, migrationID, targetServer, site.AppServerID, logFn)
	if err != nil {
		logFn("error", "Repair failed: "+err.Error())
		return nil, nil, err
	}
	defer en.Disconnect()

	summary, err := en.RepairWordPress(ctx, domains, knownDBs, sourcePHP)
	if err != nil {
		logFn("error", "Repair failed: "+err.Error())
		return nil, nil, err
	}
	if len(summary) == 0 {
		logFn("info", "Repair WordPress finished: nothing needed changing")
	} else {
		logFn("info", "Repair WordPress finished: "+strings.Join(summary, "; "))
	}
	if n := len(en.Warnings()); n > 0 {
		logFn("warn", fmt.Sprintf("Repair finished with %d warning(s); see the lines above", n))
	}
	status, err := e.GetMigrationStatus(ctx, migrationID)
	return status, summary, err
}

// RefreshAccountsCache re-reads the account list of a source server and stores it, so the
// New Migration page shows suspended/changed accounts without a manual Refresh.
func (e *Engine) RefreshAccountsCache(ctx context.Context, serverID string) (int, error) {
	server, err := e.db.GetServer(ctx, serverID)
	if err != nil {
		return 0, err
	}
	if common.PanelType(server.PanelType) != common.PanelTypeDirectAdmin && !agentless.IsAgentless(server.PanelType) {
		return 0, nil
	}
	password, _ := e.db.GetDecryptedPassword(ctx, serverID)
	accounts, err := e.GetServerAccounts(ctx, server, password)
	if err != nil {
		return 0, err
	}
	if len(accounts) == 0 {
		return 0, nil
	}
	list := make([]common.Account, len(accounts))
	for i, acc := range accounts {
		siteType := ""
		if acc.IsWordPress {
			siteType = "wordpress"
		}
		list[i] = common.Account{
			Username:      acc.Username,
			Domain:        acc.Domain,
			Email:         acc.Email,
			DiskUsage:     acc.DiskUsed,
			DiskLimit:     acc.DiskLimit,
			Suspended:     acc.Suspended,
			PHPVersion:    acc.PHPVersion,
			DBSize:        acc.DBSize,
			DBCount:       len(acc.Databases),
			EmailCount:    len(acc.EmailAccounts),
			SiteType:      siteType,
			Databases:     acc.Databases,
			EmailAccounts: acc.EmailAccounts,
			AddonDomains:  acc.AddonDomains,
			Pointers:      acc.Pointers,
			IsWordPress:   acc.IsWordPress,
			SSLEnabled:    acc.SSLEnabled,
			SSLExpiry:     acc.SSLExpiry,
		}
	}
	if err := e.db.SaveServerAccounts(ctx, serverID, list); err != nil {
		return 0, err
	}
	return len(list), nil
}

// refreshAccountsCacheAsync refreshes the cache in the background (after a migration or a suspend).
func (e *Engine) refreshAccountsCacheAsync(serverID string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		if n, err := e.RefreshAccountsCache(ctx, serverID); err != nil {
			e.logger.Warn("accounts cache refresh failed", map[string]interface{}{"server_id": serverID, "error": err.Error()})
		} else if n > 0 {
			e.logger.Info("accounts cache refreshed", map[string]interface{}{"server_id": serverID, "accounts": n})
		}
	}()
}

// cancelMigrationRecord marks a migration as cancelled by the user.
func (e *Engine) cancelMigrationRecord(ctx context.Context, migrationID, detail string) {
	now := time.Now()
	e.db.UpdateMigrationProgress(ctx, migrationID, &common.MigrationProgress{
		ID: migrationID, Status: "cancelled", CurrentStep: "Cancelled", Error: "Cancelled by user", CompletedAt: &now,
	})
	e.db.AddMigrationLog(ctx, migrationID, "warn", fmt.Sprintf("Migration cancelled by user (%s). Anything already created on the target is left in place; re-running reuses the website on the same node.", detail), nil)
}

// ClearFinishedMigrations deletes every completed, failed or cancelled migration with its logs.
func (e *Engine) ClearFinishedMigrations(ctx context.Context) (int64, error) {
	return e.db.DeleteFinishedMigrations(ctx)
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
		common.PanelTypeFTP:         {common.PanelTypeEnhance},
		common.PanelTypeWordPress:   {common.PanelTypeEnhance},
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
	if agentless.IsAgentless(string(sourceType)) {
		result.Warnings = append(result.Warnings,
			"Emails, cron jobs and DNS records are not available from an FTP/WordPress-only source; recreate them manually",
			"Database users get new passwords; wp-config.php is updated automatically, other apps need manual update",
			"The old site cannot be suspended by the tool after the switch; disable it manually",
		)
		return result, nil
	}
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
	Pointers      []string `json:"pointers,omitempty"`
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
// ListTargetDomains returns every domain already hosted on an Enhance target, optionally
// scoped to one cluster/app server. Used by the New Migration wizard to hide source accounts
// that have already been migrated there.
func (e *Engine) ListTargetDomains(ctx context.Context, targetServerID, clusterServerID string) ([]string, error) {
	server, err := e.db.GetServer(ctx, targetServerID)
	if err != nil {
		return nil, fmt.Errorf("target server not found: %w", err)
	}
	if common.PanelType(server.PanelType) != common.PanelTypeEnhance {
		return nil, nil
	}
	apiKey, _ := e.db.GetServerAPIKey(ctx, server.ID)
	en := enhance.New()
	if err := en.ConnectAPI(ctx, e.db.ToConnectionConfig(server), apiKey); err != nil {
		return nil, fmt.Errorf("failed to connect to Enhance: %w", err)
	}
	return en.ListWebsiteDomains(ctx, clusterServerID)
}

func (e *Engine) GetServerAccounts(ctx context.Context, server *storage.Server, password string) ([]AccountInfo, error) {
	switch common.PanelType(server.PanelType) {
	case common.PanelTypeDirectAdmin:
		da, err := e.connectDirectAdmin(ctx, server, password, nil)
		if err != nil {
			return nil, err
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
				Pointers:      acc.Pointers,
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
		if err := en.ConnectAPI(ctx, e.db.ToConnectionConfig(server), apiKey); err != nil {
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

	case common.PanelTypeFTP, common.PanelTypeWordPress:
		return e.agentlessAccounts(ctx, server, password)

	default:
		return nil, fmt.Errorf("unsupported panel type: %s", server.PanelType)
	}
}
