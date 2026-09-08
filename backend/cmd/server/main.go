package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/migration-tool/backend/internal/api"
	"github.com/migration-tool/backend/internal/migration"
	"github.com/migration-tool/backend/internal/storage"
	"github.com/migration-tool/backend/pkg/config"
	"github.com/migration-tool/backend/pkg/logger"
)

func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// Initialize logger
	log := logger.New(&logger.Config{
		Level:  cfg.LogLevel,
		Pretty: cfg.LogPretty,
	})

	log.Info("Starting Migration Tool Server", map[string]interface{}{
		"version": "1.0.0",
		"port":    cfg.Port,
	})

	// Initialize database
	db, err := storage.NewDatabase(&storage.Config{
		Host:      cfg.DBHost,
		Port:      cfg.DBPort,
		User:      cfg.DBUser,
		Password:  cfg.DBPassword,
		Database:  cfg.DBName,
		SSLMode:   cfg.DBSSLMode,
		MasterKey: cfg.MasterKey,
	})
	if err != nil {
		log.Fatal("Failed to connect to database", err, nil)
	}
	defer db.Close()

	// Run migrations
	ctx := context.Background()
	if err := db.Migrate(ctx); err != nil {
		log.Fatal("Failed to run database migrations", err, nil)
	}
	log.Info("Database migrations completed", nil)

	// Create work directory
	workDir := cfg.WorkDir
	if workDir == "" {
		workDir = "/var/lib/migration-tool/work"
	}
	if err := os.MkdirAll(workDir, 0755); err != nil {
		log.Fatal("Failed to create work directory", err, nil)
	}

	// Initialize migration engine
	engine := migration.NewEngine(db, log, workDir)

	// Initialize API handler
	handler := api.NewHandler(db, engine, log)

	// Setup Gin
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestLogger(log))

	// Setup routes
	handler.SetupRoutes(r)

	// Serve static files for frontend
	r.Static("/static", "./frontend/dist/static")
	r.StaticFile("/", "./frontend/dist/index.html")
	r.NoRoute(func(c *gin.Context) {
		c.File("./frontend/dist/index.html")
	})

	// Create server
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Info("Server listening", map[string]interface{}{
			"addr": srv.Addr,
		})
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("Server failed", err, nil)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("Shutting down server...", nil)

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Error("Server forced to shutdown", err, nil)
	}

	log.Info("Server stopped", nil)
}

func requestLogger(log *logger.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()

		log.Info("Request", map[string]interface{}{
			"method":  c.Request.Method,
			"path":    path,
			"status":  status,
			"latency": latency.String(),
			"ip":      c.ClientIP(),
		})
	}
}
