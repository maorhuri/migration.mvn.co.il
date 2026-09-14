// Package api provides REST API handlers
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/migration-tool/backend/internal/migration"
	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/storage"
	"github.com/migration-tool/backend/pkg/logger"
)

// Handler holds API dependencies
type Handler struct {
	db     *storage.Database
	engine *migration.Engine
	logger *logger.Logger
}

// NewHandler creates a new API handler
func NewHandler(db *storage.Database, engine *migration.Engine, log *logger.Logger) *Handler {
	return &Handler{
		db:     db,
		engine: engine,
		logger: log,
	}
}

// SetupRoutes configures the API routes
func (h *Handler) SetupRoutes(r *gin.Engine) {
	// CORS middleware
	r.Use(corsMiddleware())

	api := r.Group("/api/v1")
	{
		// Health check
		api.GET("/health", h.healthCheck)

		// Servers
		servers := api.Group("/servers")
		{
			servers.GET("", h.listServers)
			servers.POST("", h.createServer)
			servers.GET("/:id", h.getServer)
			servers.PUT("/:id", h.updateServer)
			servers.DELETE("/:id", h.deleteServer)
			servers.POST("/:id/test", h.testServerConnection)
			servers.GET("/:id/accounts", h.listServerAccounts)
			servers.POST("/:id/accounts/refresh", h.refreshServerAccounts)
			servers.GET("/:id/info", h.getServerInfo)
			servers.GET("/:id/cluster-servers", h.listClusterServers)
		}

		// SSH Keys
		keys := api.Group("/ssh-keys")
		{
			keys.GET("", h.listSSHKeys)
			keys.POST("", h.createSSHKey)
			keys.POST("/generate", h.generateSSHKey)
			keys.GET("/:id", h.getSSHKey)
			keys.DELETE("/:id", h.deleteSSHKey)
			keys.PUT("/:id/default", h.setDefaultSSHKey)
			keys.DELETE("/:id/default", h.setDefaultSSHKey)
		}

		// Migrations
		migrations := api.Group("/migrations")
		{
			migrations.GET("", h.listMigrations)
			migrations.POST("", h.startMigration)
			migrations.GET("/:id", h.getMigration)
			migrations.GET("/:id/logs", h.getMigrationLogs)
			migrations.POST("/:id/cancel", h.cancelMigration)
			migrations.POST("/clear", h.clearMigrations)
			migrations.POST("/:id/source/suspend", h.suspendSource)
			migrations.POST("/:id/source/unsuspend", h.unsuspendSource)
			migrations.POST("/:id/scan/decision", h.scanDecision)
			migrations.POST("/:id/repair/wordpress", h.repairWordPress)
			migrations.POST("/:id/rerun", h.rerunMigration)
			migrations.DELETE("/:id", h.deleteMigration)
			migrations.POST("/check-compatibility", h.checkCompatibility)
		}
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// Health check
func (h *Handler) healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
	})
}

// Server handlers

type CreateServerRequest struct {
	Name        string            `json:"name" binding:"required"`
	PanelType   string            `json:"panel_type" binding:"required"`
	Host        string            `json:"host" binding:"required"`
	Port        int               `json:"port"`
	Username    string            `json:"username" binding:"required"`
	AuthMethod  string            `json:"auth_method" binding:"required"`
	SSHKeyID    string            `json:"ssh_key_id,omitempty"`
	APIEndpoint string            `json:"api_endpoint,omitempty"`
	APIKey      string            `json:"api_key,omitempty"`
	Password    string            `json:"password,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	// Enhance specific
	EnhanceOrgID string `json:"enhance_org_id,omitempty"`
}

func (h *Handler) listServers(c *gin.Context) {
	panelType := c.Query("panel_type")

	var servers []storage.Server
	var err error

	if panelType != "" {
		servers, err = h.db.ListServersByType(c.Request.Context(), panelType)
	} else {
		servers, err = h.db.ListServers(c.Request.Context())
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": servers})
}

func (h *Handler) createServer(c *gin.Context) {
	var req CreateServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Port == 0 {
		req.Port = 22
	}

	// Build metadata with Enhance-specific fields
	metadata := make(map[string]interface{})
	if req.EnhanceOrgID != "" {
		metadata["enhance_org_id"] = req.EnhanceOrgID
	}
	metadataJSON, _ := json.Marshal(metadata)

	server := &storage.Server{
		Name:       req.Name,
		PanelType:  req.PanelType,
		Host:       req.Host,
		Port:       req.Port,
		Username:   req.Username,
		AuthMethod: req.AuthMethod,
		Metadata:   metadataJSON,
	}

	server.SSHKeyID = storage.NewNullString(req.SSHKeyID)
	server.APIEndpoint = storage.NewNullString(req.APIEndpoint)
	if req.AuthMethod == "ssh_key" && req.SSHKeyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "select an SSH key when the authentication method is SSH key"})
		return
	}

	if err := h.db.CreateServer(c.Request.Context(), server, req.Password, req.APIKey); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, server)
}

func (h *Handler) getServer(c *gin.Context) {
	id := c.Param("id")

	server, err := h.db.GetServer(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	c.JSON(http.StatusOK, server)
}

func (h *Handler) updateServer(c *gin.Context) {
	id := c.Param("id")

	var req CreateServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	server, err := h.db.GetServer(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	server.Name = req.Name
	server.PanelType = req.PanelType
	server.Host = req.Host
	if req.Port > 0 {
		server.Port = req.Port
	}
	server.Username = req.Username
	server.AuthMethod = req.AuthMethod
	server.SSHKeyID = storage.NewNullString(req.SSHKeyID)
	if req.AuthMethod == "ssh_key" && req.SSHKeyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "select an SSH key when the authentication method is SSH key"})
		return
	}
	if req.APIEndpoint != "" || req.PanelType != "enhance" {
		server.APIEndpoint = storage.NewNullString(req.APIEndpoint)
	}

	// Merge Enhance settings into metadata without dropping other keys
	if req.EnhanceOrgID != "" {
		meta := map[string]interface{}{}
		if len(server.Metadata) > 0 {
			_ = json.Unmarshal(server.Metadata, &meta)
		}
		meta["enhance_org_id"] = req.EnhanceOrgID
		if b, err := json.Marshal(meta); err == nil {
			server.Metadata = b
		}
	}
	if len(server.Metadata) == 0 {
		server.Metadata = json.RawMessage("{}")
	}

	if err := h.db.UpdateServer(c.Request.Context(), server, req.Password, req.APIKey); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, server)
}

func (h *Handler) deleteServer(c *gin.Context) {
	id := c.Param("id")

	if err := h.db.DeleteServer(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

func (h *Handler) testServerConnection(c *gin.Context) {
	id := c.Param("id")

	server, err := h.db.GetServer(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	// Get decrypted password if using password auth
	var password string
	if server.AuthMethod == "password" && server.PasswordEncrypted.Valid {
		password, err = h.db.GetDecryptedPassword(c.Request.Context(), id)
		if err != nil {
			h.logger.Error("Failed to decrypt password", err, nil)
		}
	}

	// Try to connect via SSH
	sshClient, err := h.engine.CreateSSHClient(server, password)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	defer sshClient.Disconnect()

	// Test connection by running a simple command
	output, err := sshClient.RunCommand(c.Request.Context(), "echo 'connected'")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	h.logger.Info("SSH connection test successful", map[string]interface{}{
		"server_id": id,
		"output":    output,
	})

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Connection successful",
	})
}

func (h *Handler) listServerAccounts(c *gin.Context) {
	id := c.Param("id")

	server, err := h.db.GetServer(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	// Check if we have cached accounts (skip for Enhance which has clusters)
	if server.PanelType != "enhance" {
		cachedAccounts, err := h.db.GetServerAccounts(c.Request.Context(), id)
		if err == nil && len(cachedAccounts) > 0 {
			// Same shape as the live response (AccountInfo) so the UI reads identical fields
			accounts := make([]migration.AccountInfo, len(cachedAccounts))
			for i, ca := range cachedAccounts {
				accounts[i] = migration.AccountInfo{
					Username:   ca.Username,
					Domain:     ca.Domain,
					Email:      ca.Email.String,
					DiskUsed:   ca.DiskUsage.String,
					DiskLimit:  ca.DiskLimit.String,
					DBSize:     ca.DBSize.String,
					PHPVersion: ca.PHPVersion.String,
					Suspended:  ca.Suspended,
				}
				if len(ca.Metadata) > 0 {
					var meta map[string]interface{}
					if err := json.Unmarshal(ca.Metadata, &meta); err == nil {
						accounts[i].Databases = stringList(meta["databases"])
						accounts[i].EmailAccounts = stringList(meta["email_accounts"])
						accounts[i].AddonDomains = stringList(meta["addon_domains"])
						if v, ok := meta["is_wordpress"].(bool); ok {
							accounts[i].IsWordPress = v
						}
						if v, ok := meta["ssl_enabled"].(bool); ok {
							accounts[i].SSLEnabled = v
						}
						if v, ok := meta["ssl_expiry"].(string); ok {
							accounts[i].SSLExpiry = v
						}
					}
				}
			}
			c.JSON(http.StatusOK, gin.H{
				"accounts": accounts,
				"total":    len(accounts),
				"cached":   true,
			})
			return
		}
	}

	// No cache, fetch from server
	password, _ := h.db.GetDecryptedPassword(c.Request.Context(), id)

	h.logger.Info("Fetching accounts from server", map[string]interface{}{
		"server_id":  id,
		"panel_type": server.PanelType,
	})

	accounts, err := h.engine.GetServerAccounts(c.Request.Context(), server, password)
	if err != nil {
		h.logger.Error("Failed to get accounts", err, map[string]interface{}{
			"server_id": id,
		})
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Cache the accounts (skip for Enhance)
	if server.PanelType != "enhance" && len(accounts) > 0 {
		// Convert AccountInfo to common.Account for caching
		commonAccounts := make([]common.Account, len(accounts))
		for i, acc := range accounts {
			commonAccounts[i] = common.Account{
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
				SiteType:      getSiteType(acc.IsWordPress),
				Databases:     acc.Databases,
				EmailAccounts: acc.EmailAccounts,
				AddonDomains:  acc.AddonDomains,
				IsWordPress:   acc.IsWordPress,
				SSLEnabled:    acc.SSLEnabled,
				SSLExpiry:     acc.SSLExpiry,
			}
		}
		if err := h.db.SaveServerAccounts(c.Request.Context(), id, commonAccounts); err != nil {
			h.logger.Error("Failed to cache accounts", err, nil)
		}
	}

	h.logger.Info("Accounts fetched", map[string]interface{}{
		"server_id": id,
		"count":     len(accounts),
	})

	c.JSON(http.StatusOK, gin.H{
		"accounts": accounts,
		"total":    len(accounts),
		"cached":   false,
	})
}

// refreshServerAccounts forces a refresh of cached accounts
func (h *Handler) refreshServerAccounts(c *gin.Context) {
	id := c.Param("id")

	server, err := h.db.GetServer(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	password, _ := h.db.GetDecryptedPassword(c.Request.Context(), id)

	h.logger.Info("Refreshing accounts from server", map[string]interface{}{
		"server_id":  id,
		"panel_type": server.PanelType,
	})

	accounts, err := h.engine.GetServerAccounts(c.Request.Context(), server, password)
	if err != nil {
		h.logger.Error("Failed to get accounts", err, map[string]interface{}{
			"server_id": id,
		})
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Save to cache (skip for Enhance)
	if server.PanelType != "enhance" && len(accounts) > 0 {
		commonAccounts := make([]common.Account, len(accounts))
		for i, acc := range accounts {
			commonAccounts[i] = common.Account{
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
				SiteType:      getSiteType(acc.IsWordPress),
				Databases:     acc.Databases,
				EmailAccounts: acc.EmailAccounts,
				AddonDomains:  acc.AddonDomains,
				IsWordPress:   acc.IsWordPress,
				SSLEnabled:    acc.SSLEnabled,
				SSLExpiry:     acc.SSLExpiry,
			}
		}
		if err := h.db.SaveServerAccounts(c.Request.Context(), id, commonAccounts); err != nil {
			h.logger.Error("Failed to cache accounts", err, nil)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"accounts":  accounts,
		"total":     len(accounts),
		"refreshed": true,
	})
}

// stringList converts a decoded JSON array to []string
func stringList(v interface{}) []string {
	items, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, it := range items {
		if s, ok := it.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// getSiteType returns site type string based on flags
func getSiteType(isWordPress bool) string {
	if isWordPress {
		return "wordpress"
	}
	return ""
}

func (h *Handler) getServerInfo(c *gin.Context) {
	id := c.Param("id")

	server, err := h.db.GetServer(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	// Get decrypted password if using password auth
	var password string
	if server.AuthMethod == "password" && server.PasswordEncrypted.Valid {
		password, err = h.db.GetDecryptedPassword(c.Request.Context(), id)
		if err != nil {
			h.logger.Error("Failed to decrypt password", err, nil)
		}
	}

	// Get server info
	info, err := h.engine.GetServerInfo(c.Request.Context(), server, password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, info)
}

func (h *Handler) listClusterServers(c *gin.Context) {
	id := c.Param("id")

	server, err := h.db.GetServer(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	// Only Enhance servers have cluster servers
	if server.PanelType != "enhance" {
		c.JSON(http.StatusOK, gin.H{"items": []interface{}{}})
		return
	}

	// Get API key
	apiKey, err := h.db.GetServerAPIKey(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get API key"})
		return
	}

	// Get cluster servers
	servers, err := h.engine.GetEnhanceClusterServers(c.Request.Context(), server, apiKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": servers})
}

// SSH Key handlers

type CreateSSHKeyRequest struct {
	Name       string `json:"name" binding:"required"`
	PublicKey  string `json:"public_key,omitempty"` // optional: derived from the private key when empty
	PrivateKey string `json:"private_key" binding:"required"`
	Passphrase string `json:"passphrase,omitempty"`
}

func (h *Handler) listSSHKeys(c *gin.Context) {
	keys, err := h.db.ListSSHKeys(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	views := make([]sshKeyView, 0, len(keys))
	for i := range keys {
		views = append(views, keyView(&keys[i]))
	}
	c.JSON(http.StatusOK, gin.H{"items": views})
}

func (h *Handler) createSSHKey(c *gin.Context) {
	var req CreateSSHKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	derivedPub, fingerprint, err := inspectPrivateKey(req.PrivateKey, req.Passphrase)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "private key could not be parsed (OpenSSH or PEM format expected): " + err.Error()})
		return
	}
	publicKey := strings.TrimSpace(req.PublicKey)
	if publicKey == "" {
		publicKey = derivedPub
	} else {
		given := strings.Fields(publicKey)
		derived := strings.Fields(derivedPub)
		if len(given) < 2 || len(derived) < 2 || given[0] != derived[0] || given[1] != derived[1] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "public key does not match the private key"})
			return
		}
	}

	key := &storage.SSHKey{
		Name:        req.Name,
		PublicKey:   publicKey,
		Fingerprint: storage.NewNullString(fingerprint),
	}
	if err := h.db.CreateSSHKey(c.Request.Context(), key, req.PrivateKey, req.Passphrase); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, keyView(key))
}

func (h *Handler) getSSHKey(c *gin.Context) {
	id := c.Param("id")

	key, err := h.db.GetSSHKey(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "SSH key not found"})
		return
	}

	c.JSON(http.StatusOK, keyView(key))
}

func (h *Handler) deleteSSHKey(c *gin.Context) {
	id := c.Param("id")

	if err := h.db.DeleteSSHKey(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// Migration handlers

type StartMigrationRequest struct {
	SourceServerID        string `json:"source_server_id" binding:"required"`
	TargetServerID        string `json:"target_server_id" binding:"required"`
	TargetClusterServerID string `json:"target_cluster_server_id,omitempty"` // Enhance: which cluster server hosts the website
	Username              string `json:"username" binding:"required"`
	NewPassword           string `json:"new_password,omitempty"`
}

type CheckCompatibilityRequest struct {
	SourceServerID string `json:"source_server_id" binding:"required"`
	TargetServerID string `json:"target_server_id" binding:"required"`
	Username       string `json:"username" binding:"required"`
}

func (h *Handler) listMigrations(c *gin.Context) {
	migrations, err := h.engine.ListMigrations(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": migrations})
}

func (h *Handler) startMigration(c *gin.Context) {
	var req StartMigrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.engine.StartMigration(c.Request.Context(), &migration.MigrationRequest{
		SourceServerID:        req.SourceServerID,
		TargetServerID:        req.TargetServerID,
		TargetClusterServerID: req.TargetClusterServerID,
		Username:              req.Username,
		NewPassword:           req.NewPassword,
	})
	if err != nil {
		if errors.Is(err, migration.ErrClusterServerRequired) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusAccepted, result)
}

func (h *Handler) getMigration(c *gin.Context) {
	id := c.Param("id")

	result, err := h.engine.GetMigrationStatus(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "migration not found"})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) getMigrationLogs(c *gin.Context) {
	id := c.Param("id")

	logs, err := h.engine.GetMigrationLogs(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": logs})
}

func (h *Handler) cancelMigration(c *gin.Context) {
	id := c.Param("id")

	err := h.engine.CancelMigration(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Migration cancelled"})
}

func (h *Handler) deleteMigration(c *gin.Context) {
	id := c.Param("id")

	err := h.engine.DeleteMigration(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Migration deleted"})
}

func (h *Handler) checkCompatibility(c *gin.Context) {
	var req CheckCompatibilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.engine.CheckCompatibility(c.Request.Context(),
		req.SourceServerID, req.TargetServerID, req.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
