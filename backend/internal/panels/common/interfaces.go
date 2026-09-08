// Package common defines shared interfaces and types for all panel implementations
package common

import (
	"context"
	"io"
	"time"
)

// PanelType represents the type of hosting panel
type PanelType string

const (
	PanelTypeDirectAdmin PanelType = "directadmin"
	PanelTypeEnhance     PanelType = "enhance"
	PanelTypeCPanel      PanelType = "cpanel"
	PanelTypeFTP         PanelType = "ftp"
)

// ConnectionConfig holds connection details for a server
type ConnectionConfig struct {
	ID          string            `json:"id" db:"id"`
	Name        string            `json:"name" db:"name"`
	PanelType   PanelType         `json:"panel_type" db:"panel_type"`
	Host        string            `json:"host" db:"host"`
	Port        int               `json:"port" db:"port"`
	Username    string            `json:"username" db:"username"`
	AuthMethod  AuthMethod        `json:"auth_method" db:"auth_method"`
	SSHKeyID    string            `json:"ssh_key_id,omitempty" db:"ssh_key_id"`
	APIEndpoint string            `json:"api_endpoint,omitempty" db:"api_endpoint"`
	APIKey      string            `json:"-" db:"api_key"` // Never expose in JSON
	Metadata    map[string]string `json:"metadata,omitempty" db:"metadata"`
	CreatedAt   time.Time         `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at" db:"updated_at"`
}

// AuthMethod represents authentication method
type AuthMethod string

const (
	AuthMethodPassword AuthMethod = "password"
	AuthMethodSSHKey   AuthMethod = "ssh_key"
	AuthMethodAPIKey   AuthMethod = "api_key"
)

// Account represents a hosting account/user
type Account struct {
	Username       string            `json:"username"`
	Email          string            `json:"email"`
	Domain         string            `json:"domain"`
	Package        string            `json:"package,omitempty"`
	DiskUsage      string            `json:"disk_usage"`
	DiskLimit      string            `json:"disk_limit"`
	BandwidthUsage int64             `json:"bandwidth_usage"`
	BandwidthLimit int64             `json:"bandwidth_limit"`
	Suspended      bool              `json:"suspended"`
	CreatedAt      time.Time         `json:"created_at"`
	Metadata       map[string]string `json:"metadata,omitempty"`
	// Additional fields for detailed view
	PHPVersion    string   `json:"php_version,omitempty"`
	Databases     []string `json:"databases,omitempty"`
	EmailAccounts []string `json:"email_accounts,omitempty"`
	AddonDomains  []string `json:"addon_domains,omitempty"`
	SSLEnabled    bool     `json:"ssl_enabled,omitempty"`
	SSLExpiry     string   `json:"ssl_expiry,omitempty"`
	IsWordPress   bool     `json:"is_wordpress"`
	DBSize        string   `json:"db_size,omitempty"`
}

// Domain represents a domain configuration
type Domain struct {
	Name         string   `json:"name"`
	Type         string   `json:"type"` // main, addon, subdomain, alias
	DocumentRoot string   `json:"document_root"`
	SSL          *SSLCert `json:"ssl,omitempty"`
	PHPVersion   string   `json:"php_version,omitempty"`
}

// SSLCert represents SSL certificate data
type SSLCert struct {
	Certificate string    `json:"certificate"`
	PrivateKey  string    `json:"private_key"`
	CABundle    string    `json:"ca_bundle,omitempty"`
	ExpiresAt   time.Time `json:"expires_at"`
	AutoRenew   bool      `json:"auto_renew"`
}

// Database represents a database
type Database struct {
	Name    string   `json:"name"`
	Type    string   `json:"type"` // mysql, postgresql
	Size    int64    `json:"size"`
	Users   []DBUser `json:"users"`
	Charset string   `json:"charset"`
}

// DBUser represents a database user
type DBUser struct {
	Username   string   `json:"username"`
	Host       string   `json:"host"`
	Privileges []string `json:"privileges"`
}

// EmailAccount represents an email account
type EmailAccount struct {
	Email     string `json:"email"`
	Quota     int64  `json:"quota"`
	QuotaUsed int64  `json:"quota_used"`
	ForwardTo string `json:"forward_to,omitempty"`
}

// CronJob represents a cron job
type CronJob struct {
	Minute  string `json:"minute"`
	Hour    string `json:"hour"`
	Day     string `json:"day"`
	Month   string `json:"month"`
	Weekday string `json:"weekday"`
	Command string `json:"command"`
}

// DNSRecord represents a DNS record
type DNSRecord struct {
	Type     string `json:"type"`
	Name     string `json:"name"`
	Value    string `json:"value"`
	TTL      int    `json:"ttl"`
	Priority int    `json:"priority,omitempty"`
}

// ExportData contains all exported data from a panel
type ExportData struct {
	Account     Account        `json:"account"`
	Domains     []Domain       `json:"domains"`
	Databases   []Database     `json:"databases"`
	Emails      []EmailAccount `json:"emails"`
	CronJobs    []CronJob      `json:"cron_jobs"`
	DNSRecords  []DNSRecord    `json:"dns_records"`
	FilesPath   string         `json:"files_path"` // Path to exported files archive
	ExportedAt  time.Time      `json:"exported_at"`
	SourcePanel PanelType      `json:"source_panel"`
}

// MigrationProgress tracks migration progress
type MigrationProgress struct {
	ID               string     `json:"id"`
	Status           string     `json:"status"` // pending, running, completed, failed
	CurrentStep      string     `json:"current_step"`
	TotalSteps       int        `json:"total_steps"`
	CompletedSteps   int        `json:"completed_steps"`
	BytesTransferred int64      `json:"bytes_transferred"`
	TotalBytes       int64      `json:"total_bytes"`
	StartedAt        time.Time  `json:"started_at"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
	Error            string     `json:"error,omitempty"`
	Logs             []string   `json:"logs"`
}

// PanelExporter interface for exporting data from a panel
type PanelExporter interface {
	// Connect establishes connection to the panel
	Connect(ctx context.Context, config *ConnectionConfig) error

	// Disconnect closes the connection
	Disconnect() error

	// TestConnection tests if the connection is working
	TestConnection(ctx context.Context) error

	// ListAccounts returns all accounts on the server
	ListAccounts(ctx context.Context) ([]Account, error)

	// GetAccount returns details for a specific account
	GetAccount(ctx context.Context, username string) (*Account, error)

	// ExportAccount exports all data for an account
	ExportAccount(ctx context.Context, username string, outputDir string, progress chan<- MigrationProgress) (*ExportData, error)

	// ExportFiles exports files for an account
	ExportFiles(ctx context.Context, username string, outputDir string, progress chan<- MigrationProgress) error

	// ExportDatabases exports databases for an account
	ExportDatabases(ctx context.Context, username string, outputDir string) ([]Database, error)

	// ExportEmails exports email accounts and data
	ExportEmails(ctx context.Context, username string, outputDir string) ([]EmailAccount, error)

	// GetPanelType returns the panel type
	GetPanelType() PanelType
}

// PanelImporter interface for importing data to a panel
type PanelImporter interface {
	// Connect establishes connection to the panel
	Connect(ctx context.Context, config *ConnectionConfig) error

	// Disconnect closes the connection
	Disconnect() error

	// TestConnection tests if the connection is working
	TestConnection(ctx context.Context) error

	// CreateAccount creates a new account
	CreateAccount(ctx context.Context, account *Account, password string) error

	// ImportAccount imports all data for an account
	ImportAccount(ctx context.Context, data *ExportData, password string, progress chan<- MigrationProgress) error

	// ImportFiles imports files to an account
	ImportFiles(ctx context.Context, username string, sourcePath string, progress chan<- MigrationProgress) error

	// ImportDatabases imports databases
	ImportDatabases(ctx context.Context, username string, databases []Database, dumpDir string) error

	// ImportEmails imports email accounts
	ImportEmails(ctx context.Context, username string, emails []EmailAccount) error

	// SetupDomain configures a domain
	SetupDomain(ctx context.Context, username string, domain *Domain) error

	// SetupSSL configures SSL for a domain
	SetupSSL(ctx context.Context, domain string, cert *SSLCert) error

	// GetPanelType returns the panel type
	GetPanelType() PanelType
}

// Panel combines both exporter and importer capabilities
type Panel interface {
	PanelExporter
	PanelImporter
}

// FileTransfer interface for file operations
type FileTransfer interface {
	// Upload uploads a file
	Upload(ctx context.Context, localPath, remotePath string) error

	// Download downloads a file
	Download(ctx context.Context, remotePath, localPath string) error

	// UploadStream uploads from a reader
	UploadStream(ctx context.Context, reader io.Reader, remotePath string, size int64) error

	// DownloadStream downloads to a writer
	DownloadStream(ctx context.Context, remotePath string, writer io.Writer) error

	// List lists files in a directory
	List(ctx context.Context, path string) ([]FileInfo, error)

	// Mkdir creates a directory
	Mkdir(ctx context.Context, path string) error

	// Remove removes a file or directory
	Remove(ctx context.Context, path string) error

	// Stat returns file info
	Stat(ctx context.Context, path string) (*FileInfo, error)
}

// FileInfo represents file information
type FileInfo struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	Size    int64     `json:"size"`
	Mode    string    `json:"mode"`
	ModTime time.Time `json:"mod_time"`
	IsDir   bool      `json:"is_dir"`
}

// CompatibilityResult represents compatibility check result
type CompatibilityResult struct {
	Compatible bool              `json:"compatible"`
	Warnings   []string          `json:"warnings,omitempty"`
	Errors     []string          `json:"errors,omitempty"`
	Mappings   map[string]string `json:"mappings,omitempty"` // Source -> Target mappings
}

// CompatibilityChecker checks compatibility between panels
type CompatibilityChecker interface {
	// CheckCompatibility checks if export data is compatible with target panel
	CheckCompatibility(ctx context.Context, data *ExportData, target PanelType) (*CompatibilityResult, error)
}
