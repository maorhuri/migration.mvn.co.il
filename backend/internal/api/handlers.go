// Package api provides REST API handlers
package api

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/migration-tool/backend/internal/migration"
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
			servers.GET("/:id/info", h.getServerInfo)
			servers.GET("/:id/cluster-servers", h.listClusterServers)
		}

		// SSH Keys
		keys := api.Group("/ssh-keys")
		{
			keys.GET("", h.listSSHKeys)
			keys.POST("", h.createSSHKey)
			keys.GET("/:id", h.getSSHKey)
			keys.DELETE("/:id", h.deleteSSHKey)
		}

		// Migrations
		migrations := api.Group("/migrations")
		{
			migrations.GET("", h.listMigrations)
			migrations.POST("", h.startMigration)
			migrations.GET("/:id", h.getMigration)
			migrations.GET("/:id/logs", h.getMigrationLogs)
			migrations.POST("/:id/cancel", h.cancelMigration)
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

	if req.SSHKeyID != "" {
		server.SSHKeyID = sql.NullString{String: req.SSHKeyID, Valid: true}
	}
	if req.APIEndpoint != "" {
		server.APIEndpoint = sql.NullString{String: req.APIEndpoint, Valid: true}
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

	if req.SSHKeyID != "" {
		server.SSHKeyID = sql.NullString{String: req.SSHKeyID, Valid: true}
	}
	if req.APIEndpoint != "" {
		server.APIEndpoint = sql.NullString{String: req.APIEndpoint, Valid: true}
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

	// Get decrypted password if using password auth
	var password string
	if server.AuthMethod == "password" && server.PasswordEncrypted.Valid {
		password, err = h.db.GetDecryptedPassword(c.Request.Context(), id)
		if err != nil {
			h.logger.Error("Failed to decrypt password", err, nil)
		}
	}

	// Get accounts based on panel type
	h.logger.Info("Fetching accounts", map[string]interface{}{
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

	h.logger.Info("Accounts fetched", map[string]interface{}{
		"server_id": id,
		"count":     len(accounts),
	})

	c.JSON(http.StatusOK, gin.H{
		"accounts": accounts,
		"total":    len(accounts),
	})
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
	PublicKey  string `json:"public_key" binding:"required"`
	PrivateKey string `json:"private_key" binding:"required"`
	Passphrase string `json:"passphrase,omitempty"`
}

func (h *Handler) listSSHKeys(c *gin.Context) {
	keys, err := h.db.ListSSHKeys(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": keys})
}

func (h *Handler) createSSHKey(c *gin.Context) {
	var req CreateSSHKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	key := &storage.SSHKey{
		Name:      req.Name,
		PublicKey: req.PublicKey,
	}

	if err := h.db.CreateSSHKey(c.Request.Context(), key, req.PrivateKey, req.Passphrase); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, key)
}

func (h *Handler) getSSHKey(c *gin.Context) {
	id := c.Param("id")

	key, err := h.db.GetSSHKey(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "SSH key not found"})
		return
	}

	c.JSON(http.StatusOK, key)
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
	SourceServerID string `json:"source_server_id" binding:"required"`
	TargetServerID string `json:"target_server_id" binding:"required"`
	Username       string `json:"username" binding:"required"`
	NewPassword    string `json:"new_password,omitempty"`
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
		SourceServerID: req.SourceServerID,
		TargetServerID: req.TargetServerID,
		Username:       req.Username,
		NewPassword:    req.NewPassword,
	})
	if err != nil {
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
