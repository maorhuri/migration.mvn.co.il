// Package storage handles database operations and secure credential storage
package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/pkg/crypto"
)

// Database handles all database operations
type Database struct {
	db        *sqlx.DB
	encryptor *crypto.Encryptor
}

// Config holds database configuration
type Config struct {
	Host      string
	Port      int
	User      string
	Password  string
	Database  string
	SSLMode   string
	MasterKey string // For encrypting sensitive data
}

// NewDatabase creates a new database connection
func NewDatabase(cfg *Config) (*Database, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.Database, cfg.SSLMode,
	)

	db, err := sqlx.Connect("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Configure connection pool
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	return &Database{
		db:        db,
		encryptor: crypto.NewEncryptor(cfg.MasterKey),
	}, nil
}

// Close closes the database connection
func (d *Database) Close() error {
	return d.db.Close()
}

// Migrate runs database migrations
func (d *Database) Migrate(ctx context.Context) error {
	migrations := []string{
		// Servers table
		`CREATE TABLE IF NOT EXISTS servers (
			id UUID PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			panel_type VARCHAR(50) NOT NULL,
			host VARCHAR(255) NOT NULL,
			port INTEGER NOT NULL DEFAULT 22,
			username VARCHAR(255) NOT NULL,
			auth_method VARCHAR(50) NOT NULL,
			ssh_key_id UUID,
			api_endpoint VARCHAR(500),
			api_key_encrypted TEXT,
			password_encrypted TEXT,
			metadata JSONB DEFAULT '{}',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(name)
		)`,

		// SSH Keys table
		`CREATE TABLE IF NOT EXISTS ssh_keys (
			id UUID PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			public_key TEXT NOT NULL,
			private_key_encrypted TEXT NOT NULL,
			passphrase_encrypted TEXT,
			fingerprint VARCHAR(255),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(name)
		)`,

		// Migrations history table
		`CREATE TABLE IF NOT EXISTS migrations (
			id UUID PRIMARY KEY,
			source_server_id UUID NOT NULL REFERENCES servers(id),
			target_server_id UUID NOT NULL REFERENCES servers(id),
			account_username VARCHAR(255) NOT NULL,
			status VARCHAR(50) NOT NULL DEFAULT 'pending',
			current_step VARCHAR(255),
			total_steps INTEGER DEFAULT 0,
			completed_steps INTEGER DEFAULT 0,
			bytes_transferred BIGINT DEFAULT 0,
			total_bytes BIGINT DEFAULT 0,
			error_message TEXT,
			export_data JSONB,
			started_at TIMESTAMP WITH TIME ZONE,
			completed_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Migration logs table
		`CREATE TABLE IF NOT EXISTS migration_logs (
			id UUID PRIMARY KEY,
			migration_id UUID NOT NULL REFERENCES migrations(id) ON DELETE CASCADE,
			level VARCHAR(20) NOT NULL,
			message TEXT NOT NULL,
			metadata JSONB DEFAULT '{}',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Create indexes
		`CREATE INDEX IF NOT EXISTS idx_servers_panel_type ON servers(panel_type)`,
		`CREATE INDEX IF NOT EXISTS idx_migrations_status ON migrations(status)`,
		`CREATE INDEX IF NOT EXISTS idx_migrations_source ON migrations(source_server_id)`,
		`CREATE INDEX IF NOT EXISTS idx_migrations_target ON migrations(target_server_id)`,
		`CREATE INDEX IF NOT EXISTS idx_migration_logs_migration ON migration_logs(migration_id)`,
	}

	for _, migration := range migrations {
		if _, err := d.db.ExecContext(ctx, migration); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}

	return nil
}

// Server represents a server in the database
type Server struct {
	ID                string          `db:"id" json:"id"`
	Name              string          `db:"name" json:"name"`
	PanelType         string          `db:"panel_type" json:"panel_type"`
	Host              string          `db:"host" json:"host"`
	Port              int             `db:"port" json:"port"`
	Username          string          `db:"username" json:"username"`
	AuthMethod        string          `db:"auth_method" json:"auth_method"`
	SSHKeyID          sql.NullString  `db:"ssh_key_id" json:"ssh_key_id,omitempty"`
	APIEndpoint       sql.NullString  `db:"api_endpoint" json:"api_endpoint,omitempty"`
	APIKeyEncrypted   sql.NullString  `db:"api_key_encrypted" json:"-"`
	PasswordEncrypted sql.NullString  `db:"password_encrypted" json:"-"`
	Metadata          json.RawMessage `db:"metadata" json:"metadata,omitempty"`
	CreatedAt         time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt         time.Time       `db:"updated_at" json:"updated_at"`
}

// SSHKey represents an SSH key in the database
type SSHKey struct {
	ID                  string         `db:"id" json:"id"`
	Name                string         `db:"name" json:"name"`
	PublicKey           string         `db:"public_key" json:"public_key"`
	PrivateKeyEncrypted string         `db:"private_key_encrypted" json:"-"`
	PassphraseEncrypted sql.NullString `db:"passphrase_encrypted" json:"-"`
	Fingerprint         sql.NullString `db:"fingerprint" json:"fingerprint,omitempty"`
	CreatedAt           time.Time      `db:"created_at" json:"created_at"`
}

// Migration represents a migration record
type Migration struct {
	ID               string          `db:"id" json:"id"`
	SourceServerID   string          `db:"source_server_id" json:"source_server_id"`
	TargetServerID   string          `db:"target_server_id" json:"target_server_id"`
	AccountUsername  string          `db:"account_username" json:"account_username"`
	Status           string          `db:"status" json:"status"`
	CurrentStep      sql.NullString  `db:"current_step" json:"current_step,omitempty"`
	TotalSteps       int             `db:"total_steps" json:"total_steps"`
	CompletedSteps   int             `db:"completed_steps" json:"completed_steps"`
	BytesTransferred int64           `db:"bytes_transferred" json:"bytes_transferred"`
	TotalBytes       int64           `db:"total_bytes" json:"total_bytes"`
	ErrorMessage     sql.NullString  `db:"error_message" json:"error_message,omitempty"`
	ExportData       json.RawMessage `db:"export_data" json:"export_data,omitempty"`
	StartedAt        sql.NullTime    `db:"started_at" json:"started_at,omitempty"`
	CompletedAt      sql.NullTime    `db:"completed_at" json:"completed_at,omitempty"`
	CreatedAt        time.Time       `db:"created_at" json:"created_at"`
}

// MigrationLog represents a log entry for a migration
type MigrationLog struct {
	ID          string          `db:"id" json:"id"`
	MigrationID string          `db:"migration_id" json:"migration_id"`
	Level       string          `db:"level" json:"level"`
	Message     string          `db:"message" json:"message"`
	Metadata    json.RawMessage `db:"metadata" json:"metadata,omitempty"`
	CreatedAt   time.Time       `db:"created_at" json:"created_at"`
}

// CreateServer creates a new server
func (d *Database) CreateServer(ctx context.Context, server *Server, password, apiKey string) error {
	server.ID = uuid.New().String()
	server.CreatedAt = time.Now()
	server.UpdatedAt = time.Now()

	// Encrypt sensitive data
	if password != "" {
		encrypted, err := d.encryptor.EncryptString(password)
		if err != nil {
			return fmt.Errorf("failed to encrypt password: %w", err)
		}
		server.PasswordEncrypted = sql.NullString{String: encrypted, Valid: true}
	}

	if apiKey != "" {
		encrypted, err := d.encryptor.EncryptString(apiKey)
		if err != nil {
			return fmt.Errorf("failed to encrypt API key: %w", err)
		}
		server.APIKeyEncrypted = sql.NullString{String: encrypted, Valid: true}
	}

	query := `
		INSERT INTO servers (id, name, panel_type, host, port, username, auth_method, 
			ssh_key_id, api_endpoint, api_key_encrypted, password_encrypted, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`

	_, err := d.db.ExecContext(ctx, query,
		server.ID, server.Name, server.PanelType, server.Host, server.Port,
		server.Username, server.AuthMethod, server.SSHKeyID, server.APIEndpoint,
		server.APIKeyEncrypted, server.PasswordEncrypted, server.Metadata,
		server.CreatedAt, server.UpdatedAt,
	)

	return err
}

// GetServer retrieves a server by ID
func (d *Database) GetServer(ctx context.Context, id string) (*Server, error) {
	var server Server
	err := d.db.GetContext(ctx, &server, "SELECT * FROM servers WHERE id = $1", id)
	if err != nil {
		return nil, err
	}
	return &server, nil
}

// GetServerByName retrieves a server by name
func (d *Database) GetServerByName(ctx context.Context, name string) (*Server, error) {
	var server Server
	err := d.db.GetContext(ctx, &server, "SELECT * FROM servers WHERE name = $1", name)
	if err != nil {
		return nil, err
	}
	return &server, nil
}

// ListServers lists all servers
func (d *Database) ListServers(ctx context.Context) ([]Server, error) {
	var servers []Server
	err := d.db.SelectContext(ctx, &servers, "SELECT * FROM servers ORDER BY name")
	return servers, err
}

// ListServersByType lists servers by panel type
func (d *Database) ListServersByType(ctx context.Context, panelType string) ([]Server, error) {
	var servers []Server
	err := d.db.SelectContext(ctx, &servers,
		"SELECT * FROM servers WHERE panel_type = $1 ORDER BY name", panelType)
	return servers, err
}

// UpdateServer updates a server
func (d *Database) UpdateServer(ctx context.Context, server *Server, password, apiKey string) error {
	server.UpdatedAt = time.Now()

	// Encrypt sensitive data if provided
	if password != "" {
		encrypted, err := d.encryptor.EncryptString(password)
		if err != nil {
			return fmt.Errorf("failed to encrypt password: %w", err)
		}
		server.PasswordEncrypted = sql.NullString{String: encrypted, Valid: true}
	}

	if apiKey != "" {
		encrypted, err := d.encryptor.EncryptString(apiKey)
		if err != nil {
			return fmt.Errorf("failed to encrypt API key: %w", err)
		}
		server.APIKeyEncrypted = sql.NullString{String: encrypted, Valid: true}
	}

	query := `
		UPDATE servers SET 
			name = $2, panel_type = $3, host = $4, port = $5, username = $6,
			auth_method = $7, ssh_key_id = $8, api_endpoint = $9, 
			api_key_encrypted = COALESCE($10, api_key_encrypted),
			password_encrypted = COALESCE($11, password_encrypted),
			metadata = $12, updated_at = $13
		WHERE id = $1
	`

	_, err := d.db.ExecContext(ctx, query,
		server.ID, server.Name, server.PanelType, server.Host, server.Port,
		server.Username, server.AuthMethod, server.SSHKeyID, server.APIEndpoint,
		server.APIKeyEncrypted, server.PasswordEncrypted, server.Metadata, server.UpdatedAt,
	)

	return err
}

// DeleteServer deletes a server
func (d *Database) DeleteServer(ctx context.Context, id string) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM servers WHERE id = $1", id)
	return err
}

// GetServerPassword retrieves and decrypts the server password
func (d *Database) GetServerPassword(ctx context.Context, id string) (string, error) {
	var encrypted sql.NullString
	err := d.db.GetContext(ctx, &encrypted,
		"SELECT password_encrypted FROM servers WHERE id = $1", id)
	if err != nil {
		return "", err
	}
	if !encrypted.Valid {
		return "", nil
	}
	return d.encryptor.DecryptString(encrypted.String)
}

// GetServerAPIKey retrieves and decrypts the server API key
func (d *Database) GetServerAPIKey(ctx context.Context, id string) (string, error) {
	var encrypted sql.NullString
	err := d.db.GetContext(ctx, &encrypted,
		"SELECT api_key_encrypted FROM servers WHERE id = $1", id)
	if err != nil {
		return "", err
	}
	if !encrypted.Valid {
		return "", nil
	}
	return d.encryptor.DecryptString(encrypted.String)
}

// GetDecryptedPassword retrieves and decrypts the server password
func (d *Database) GetDecryptedPassword(ctx context.Context, id string) (string, error) {
	var encrypted sql.NullString
	err := d.db.GetContext(ctx, &encrypted,
		"SELECT password_encrypted FROM servers WHERE id = $1", id)
	if err != nil {
		return "", err
	}
	if !encrypted.Valid {
		return "", nil
	}
	return d.encryptor.DecryptString(encrypted.String)
}

// CreateSSHKey creates a new SSH key
func (d *Database) CreateSSHKey(ctx context.Context, key *SSHKey, privateKey, passphrase string) error {
	key.ID = uuid.New().String()
	key.CreatedAt = time.Now()

	// Encrypt private key
	encrypted, err := d.encryptor.EncryptString(privateKey)
	if err != nil {
		return fmt.Errorf("failed to encrypt private key: %w", err)
	}
	key.PrivateKeyEncrypted = encrypted

	// Encrypt passphrase if provided
	if passphrase != "" {
		encrypted, err := d.encryptor.EncryptString(passphrase)
		if err != nil {
			return fmt.Errorf("failed to encrypt passphrase: %w", err)
		}
		key.PassphraseEncrypted = sql.NullString{String: encrypted, Valid: true}
	}

	query := `
		INSERT INTO ssh_keys (id, name, public_key, private_key_encrypted, passphrase_encrypted, fingerprint, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`

	_, err = d.db.ExecContext(ctx, query,
		key.ID, key.Name, key.PublicKey, key.PrivateKeyEncrypted,
		key.PassphraseEncrypted, key.Fingerprint, key.CreatedAt,
	)

	return err
}

// GetSSHKey retrieves an SSH key by ID
func (d *Database) GetSSHKey(ctx context.Context, id string) (*SSHKey, error) {
	var key SSHKey
	err := d.db.GetContext(ctx, &key, "SELECT * FROM ssh_keys WHERE id = $1", id)
	if err != nil {
		return nil, err
	}
	return &key, nil
}

// ListSSHKeys lists all SSH keys
func (d *Database) ListSSHKeys(ctx context.Context) ([]SSHKey, error) {
	var keys []SSHKey
	err := d.db.SelectContext(ctx, &keys, "SELECT * FROM ssh_keys ORDER BY name")
	return keys, err
}

// GetSSHKeyPrivateKey retrieves and decrypts the private key
func (d *Database) GetSSHKeyPrivateKey(ctx context.Context, id string) (string, error) {
	var encrypted string
	err := d.db.GetContext(ctx, &encrypted,
		"SELECT private_key_encrypted FROM ssh_keys WHERE id = $1", id)
	if err != nil {
		return "", err
	}
	return d.encryptor.DecryptString(encrypted)
}

// GetSSHKeyPassphrase retrieves and decrypts the passphrase
func (d *Database) GetSSHKeyPassphrase(ctx context.Context, id string) (string, error) {
	var encrypted sql.NullString
	err := d.db.GetContext(ctx, &encrypted,
		"SELECT passphrase_encrypted FROM ssh_keys WHERE id = $1", id)
	if err != nil {
		return "", err
	}
	if !encrypted.Valid {
		return "", nil
	}
	return d.encryptor.DecryptString(encrypted.String)
}

// DeleteSSHKey deletes an SSH key
func (d *Database) DeleteSSHKey(ctx context.Context, id string) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM ssh_keys WHERE id = $1", id)
	return err
}

// CreateMigration creates a new migration record
func (d *Database) CreateMigration(ctx context.Context, migration *Migration) error {
	migration.ID = uuid.New().String()
	migration.CreatedAt = time.Now()
	migration.Status = "pending"

	query := `
		INSERT INTO migrations (id, source_server_id, target_server_id, account_username, 
			status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`

	_, err := d.db.ExecContext(ctx, query,
		migration.ID, migration.SourceServerID, migration.TargetServerID,
		migration.AccountUsername, migration.Status, migration.CreatedAt,
	)

	return err
}

// GetMigration retrieves a migration by ID
func (d *Database) GetMigration(ctx context.Context, id string) (*Migration, error) {
	var migration Migration
	err := d.db.GetContext(ctx, &migration, "SELECT * FROM migrations WHERE id = $1", id)
	if err != nil {
		return nil, err
	}
	return &migration, nil
}

// ListMigrations lists all migrations
func (d *Database) ListMigrations(ctx context.Context) ([]Migration, error) {
	var migrations []Migration
	err := d.db.SelectContext(ctx, &migrations,
		"SELECT * FROM migrations ORDER BY created_at DESC")
	return migrations, err
}

// UpdateMigrationProgress updates migration progress
func (d *Database) UpdateMigrationProgress(ctx context.Context, id string, progress *common.MigrationProgress) error {
	query := `
		UPDATE migrations SET 
			status = $2, current_step = $3, total_steps = $4, completed_steps = $5,
			bytes_transferred = $6, total_bytes = $7, error_message = $8,
			started_at = COALESCE(started_at, $9),
			completed_at = $10
		WHERE id = $1
	`

	var completedAt sql.NullTime
	if progress.CompletedAt != nil {
		completedAt = sql.NullTime{Time: *progress.CompletedAt, Valid: true}
	}

	_, err := d.db.ExecContext(ctx, query,
		id, progress.Status, progress.CurrentStep, progress.TotalSteps,
		progress.CompletedSteps, progress.BytesTransferred, progress.TotalBytes,
		progress.Error, progress.StartedAt, completedAt,
	)

	return err
}

// AddMigrationLog adds a log entry for a migration
func (d *Database) AddMigrationLog(ctx context.Context, migrationID, level, message string, metadata map[string]interface{}) error {
	id := uuid.New().String()

	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		metadataJSON = []byte("{}")
	}

	query := `
		INSERT INTO migration_logs (id, migration_id, level, message, metadata, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`

	_, err = d.db.ExecContext(ctx, query,
		id, migrationID, level, message, metadataJSON, time.Now(),
	)

	return err
}

// GetMigrationLogs retrieves logs for a migration
func (d *Database) GetMigrationLogs(ctx context.Context, migrationID string) ([]MigrationLog, error) {
	var logs []MigrationLog
	err := d.db.SelectContext(ctx, &logs,
		"SELECT * FROM migration_logs WHERE migration_id = $1 ORDER BY created_at", migrationID)
	return logs, err
}

// ToConnectionConfig converts a Server to ConnectionConfig
func (d *Database) ToConnectionConfig(server *Server) *common.ConnectionConfig {
	config := &common.ConnectionConfig{
		ID:         server.ID,
		Name:       server.Name,
		PanelType:  common.PanelType(server.PanelType),
		Host:       server.Host,
		Port:       server.Port,
		Username:   server.Username,
		AuthMethod: common.AuthMethod(server.AuthMethod),
		CreatedAt:  server.CreatedAt,
		UpdatedAt:  server.UpdatedAt,
	}

	if server.SSHKeyID.Valid {
		config.SSHKeyID = server.SSHKeyID.String
	}
	if server.APIEndpoint.Valid {
		config.APIEndpoint = server.APIEndpoint.String
	}

	return config
}
