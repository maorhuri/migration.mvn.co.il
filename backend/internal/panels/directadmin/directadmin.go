// Package directadmin implements DirectAdmin panel operations
package directadmin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/ssh"
)

// DirectAdmin implements the Panel interface for DirectAdmin servers
type DirectAdmin struct {
	config    *common.ConnectionConfig
	sshClient *ssh.Client
	password  string
	connected bool
	logFn     func(level, message string)
}

// SetLogger routes module log lines to the given function (in addition to stdout)
func (da *DirectAdmin) SetLogger(fn func(level, message string)) { da.logFn = fn }

func (da *DirectAdmin) logf(level, format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	fmt.Printf("[directadmin][%s] %s\n", level, msg)
	if da.logFn != nil {
		da.logFn(level, msg)
	}
}

func shq(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// New creates a new DirectAdmin panel instance
func New() *DirectAdmin {
	return &DirectAdmin{
		sshClient: ssh.NewClient(),
	}
}

// Connect establishes connection to the DirectAdmin server
func (da *DirectAdmin) Connect(ctx context.Context, config *common.ConnectionConfig) error {
	da.config = config
	return nil
}

// ConnectWithCredentials connects with password or SSH key
func (da *DirectAdmin) ConnectWithCredentials(ctx context.Context, config *common.ConnectionConfig, password string, privateKey []byte) error {
	da.config = config
	da.password = password

	if err := da.sshClient.Connect(ctx, config, password, privateKey); err != nil {
		return fmt.Errorf("failed to connect via SSH: %w", err)
	}

	if err := da.sshClient.ConnectSFTP(); err != nil {
		return fmt.Errorf("failed to connect via SFTP: %w", err)
	}

	da.connected = true
	return nil
}

// Disconnect closes the connection
func (da *DirectAdmin) Disconnect() error {
	da.connected = false
	return da.sshClient.Disconnect()
}

// TestConnection tests if the connection is working
func (da *DirectAdmin) TestConnection(ctx context.Context) error {
	if !da.connected {
		return fmt.Errorf("not connected")
	}

	// Test by checking DirectAdmin version
	output, err := da.sshClient.RunCommand(ctx, "/usr/local/directadmin/directadmin v")
	if err != nil {
		return fmt.Errorf("failed to get DirectAdmin version: %w", err)
	}

	if !strings.Contains(output, "DirectAdmin") {
		return fmt.Errorf("DirectAdmin not found on server")
	}

	return nil
}

// GetPanelType returns the panel type
func (da *DirectAdmin) GetPanelType() common.PanelType {
	return common.PanelTypeDirectAdmin
}

// ListAccounts returns all accounts on the server
func (da *DirectAdmin) ListAccounts(ctx context.Context) ([]common.Account, error) {
	if !da.connected {
		return nil, fmt.Errorf("not connected")
	}

	// Get list of users from DirectAdmin
	output, err := da.sshClient.RunCommand(ctx, "ls /usr/local/directadmin/data/users/")
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}

	usernames := strings.Fields(output)
	var accounts []common.Account
	var errors []string

	for _, username := range usernames {
		account, err := da.GetAccount(ctx, username)
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", username, err))
			continue // Skip accounts that can't be read
		}
		accounts = append(accounts, *account)
	}

	// Log errors if any
	if len(errors) > 0 && len(accounts) == 0 {
		return nil, fmt.Errorf("failed to get any accounts. Errors: %v", errors)
	}

	return accounts, nil
}

// GetAccount returns details for a specific account
func (da *DirectAdmin) GetAccount(ctx context.Context, username string) (*common.Account, error) {
	if !da.connected {
		return nil, fmt.Errorf("not connected")
	}

	account := &common.Account{
		Username: username,
		Metadata: make(map[string]string),
	}

	// Get all info in one command for speed - using bash explicitly
	script := fmt.Sprintf(`bash -c '
USER="%s"
USER_CONF="/usr/local/directadmin/data/users/$USER/user.conf"
DA_MYSQL_CONF="/usr/local/directadmin/conf/mysql.conf"

# User config
cat "$USER_CONF" 2>/dev/null
echo "---SEPARATOR---"

# Disk usage
du -sh /home/$USER 2>/dev/null | cut -f1
echo "---SEPARATOR---"

# Databases list - query MySQL directly by username prefix
MYSQL_USER=$(grep "^user=" "$DA_MYSQL_CONF" 2>/dev/null | cut -d= -f2)
MYSQL_PASS=$(grep "^passwd=" "$DA_MYSQL_CONF" 2>/dev/null | cut -d= -f2)
if [ -n "$MYSQL_USER" ] && [ -n "$MYSQL_PASS" ]; then
    mysql -u"$MYSQL_USER" -p"$MYSQL_PASS" -N -e "SHOW DATABASES LIKE '"'"'${USER}_%%'"'"'" 2>/dev/null | tr "\n" ","
fi
echo "---SEPARATOR---"

# Email list for main domain
DOMAIN=$(grep "^domain=" "$USER_CONF" 2>/dev/null | cut -d= -f2)
if [ -d "/home/$USER/imap/$DOMAIN" ]; then
    ls "/home/$USER/imap/$DOMAIN/" 2>/dev/null | tr "\n" ","
fi
echo "---SEPARATOR---"

# WordPress check
if [ -f "/home/$USER/domains/$DOMAIN/public_html/wp-config.php" ]; then
    echo "yes"
else
    echo "no"
fi
echo "---SEPARATOR---"

# SSL check
if [ -f "/usr/local/directadmin/data/users/$USER/domains/$DOMAIN.cert" ]; then
    echo "yes"
else
    echo "no"
fi
echo "---SEPARATOR---"

# PHP version - extract from openlitespeed.conf or PATH
PHP_VER=""
OLS_CONF="/usr/local/directadmin/data/users/$USER/openlitespeed.conf"
if [ -f "$OLS_CONF" ]; then
    PHP_VER=$(grep -oE "php[0-9]+" "$OLS_CONF" 2>/dev/null | head -1 | sed "s/php//" | sed "s/\(.\)/\1./")
    PHP_VER=${PHP_VER%%.}
fi
if [ -z "$PHP_VER" ]; then
    PHP_VER=$(php -v 2>/dev/null | head -1 | grep -oE "[0-9]+\.[0-9]+" | head -1)
fi
echo "$PHP_VER"
echo "---SEPARATOR---"

# DB Size - sum all databases for this user
if [ -n "$MYSQL_USER" ] && [ -n "$MYSQL_PASS" ]; then
    mysql -u"$MYSQL_USER" -p"$MYSQL_PASS" -N -e "SELECT COALESCE(ROUND(SUM(data_length + index_length) / 1024 / 1024, 1), 0) FROM information_schema.tables WHERE table_schema LIKE '"'"'${USER}_%%'"'"'" 2>/dev/null || echo "0"
else
    echo "0"
fi
'`, username)

	output, err := da.sshClient.RunCommand(ctx, script)
	if err != nil {
		return nil, fmt.Errorf("failed to get account info: %w", err)
	}

	parts := strings.Split(output, "---SEPARATOR---")

	// Parse user.conf (part 0)
	if len(parts) > 0 {
		for _, line := range strings.Split(parts[0], "\n") {
			kv := strings.SplitN(line, "=", 2)
			if len(kv) != 2 {
				continue
			}
			key := strings.TrimSpace(kv[0])
			value := strings.TrimSpace(kv[1])

			switch key {
			case "domain":
				account.Domain = value
			case "email":
				account.Email = value
			case "package":
				account.Package = value
			case "suspended":
				account.Suspended = value == "yes"
			case "quota":
				if q, err := strconv.ParseInt(value, 10, 64); err == nil {
					if q == 0 {
						account.DiskLimit = "Unlimited"
					} else {
						account.DiskLimit = fmt.Sprintf("%d MB", q)
					}
				}
			}
		}
	}

	// Disk usage (part 1)
	if len(parts) > 1 {
		account.DiskUsage = strings.TrimSpace(parts[1])
	}

	// Database list (part 2)
	if len(parts) > 2 {
		dbList := strings.TrimSpace(parts[2])
		if dbList != "" {
			dbs := strings.Split(strings.TrimSuffix(dbList, ","), ",")
			for _, db := range dbs {
				db = strings.TrimSpace(db)
				if db != "" {
					account.Databases = append(account.Databases, db)
				}
			}
		}
	}

	// Email list (part 3)
	if len(parts) > 3 {
		emailList := strings.TrimSpace(parts[3])
		if emailList != "" {
			emails := strings.Split(strings.TrimSuffix(emailList, ","), ",")
			for _, email := range emails {
				email = strings.TrimSpace(email)
				if email != "" {
					account.EmailAccounts = append(account.EmailAccounts, email+"@"+account.Domain)
				}
			}
		}
	}

	// WordPress check (part 4)
	if len(parts) > 4 {
		account.IsWordPress = strings.TrimSpace(parts[4]) == "yes"
	}

	// SSL check (part 5)
	if len(parts) > 5 {
		account.SSLEnabled = strings.TrimSpace(parts[5]) == "yes"
	}

	// PHP version (part 6)
	if len(parts) > 6 {
		php := strings.TrimSpace(parts[6])
		if php != "" {
			account.PHPVersion = php
		}
	}

	// DB Size (part 7)
	if len(parts) > 7 {
		dbSize := strings.TrimSpace(parts[7])
		if dbSize != "" && dbSize != "NULL" {
			account.DBSize = dbSize + " MB"
		}
	}

	return account, nil
}

// ExportAccount exports all data for an account
func (da *DirectAdmin) ExportAccount(ctx context.Context, username string, outputDir string, progress chan<- common.MigrationProgress) (*common.ExportData, error) {
	if !da.connected {
		return nil, fmt.Errorf("not connected")
	}

	// Create output directory
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create output directory: %w", err)
	}

	exportData := &common.ExportData{
		ExportedAt:  time.Now(),
		SourcePanel: common.PanelTypeDirectAdmin,
	}

	// Get account info
	account, err := da.GetAccount(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}
	exportData.Account = *account

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

	totalSteps := 6
	currentStep := 0

	// 1. Export domains
	sendProgress("Exporting domains", currentStep, totalSteps)
	domains, err := da.exportDomains(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("failed to export domains: %w", err)
	}
	for i := range domains {
		if domains[i].PHPVersion == "" || domains[i].PHPVersion == "default" {
			domains[i].PHPVersion = account.PHPVersion
		}
	}
	exportData.Domains = domains
	currentStep++

	// 2. Export databases
	sendProgress("Exporting databases", currentStep, totalSteps)
	databases, err := da.ExportDatabases(ctx, username, outputDir)
	if err != nil {
		return nil, fmt.Errorf("failed to export databases: %w", err)
	}
	exportData.Databases = databases
	currentStep++

	// 3. Export emails
	sendProgress("Exporting emails", currentStep, totalSteps)
	emails, err := da.ExportEmails(ctx, username, outputDir)
	if err != nil {
		da.logf("warn", "Failed to export emails: %v", err)
	}
	exportData.Emails = emails
	currentStep++

	// 4. Export cron jobs
	sendProgress("Exporting cron jobs", currentStep, totalSteps)
	cronJobs, err := da.exportCronJobs(ctx, username)
	if err != nil {
		da.logf("warn", "Failed to export cron jobs: %v", err)
	}
	exportData.CronJobs = cronJobs
	currentStep++

	// 5. Export DNS records
	sendProgress("Exporting DNS records", currentStep, totalSteps)
	dnsRecords, err := da.exportDNSRecords(ctx, username, account.Domain)
	if err != nil {
		da.logf("warn", "Failed to export DNS records: %v", err)
	}
	exportData.DNSRecords = dnsRecords
	currentStep++

	// 6. Export files
	sendProgress("Exporting files", currentStep, totalSteps)
	if err := da.ExportFiles(ctx, username, outputDir, progress); err != nil {
		return nil, fmt.Errorf("failed to export files: %w", err)
	}
	exportData.FilesPath = filepath.Join(outputDir, "files")
	currentStep++

	// Save export metadata
	metadataPath := filepath.Join(outputDir, "export_data.json")
	metadataFile, err := os.Create(metadataPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create metadata file: %w", err)
	}
	defer metadataFile.Close()

	encoder := json.NewEncoder(metadataFile)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(exportData); err != nil {
		return nil, fmt.Errorf("failed to write metadata: %w", err)
	}

	return exportData, nil
}

// ExportFiles exports files for an account using rsync (fastest method)
func (da *DirectAdmin) ExportFiles(ctx context.Context, username string, outputDir string, progress chan<- common.MigrationProgress) error {
	if !da.connected {
		return fmt.Errorf("not connected")
	}

	filesDir := filepath.Join(outputDir, "files")
	if err := os.MkdirAll(filesDir, 0755); err != nil {
		return fmt.Errorf("failed to create files directory: %w", err)
	}

	// Download using rsync (much faster than SFTP)
	publicHtmlRemote := fmt.Sprintf("/home/%s/domains", username)
	publicHtmlLocal := filepath.Join(filesDir, "domains")

	if err := os.MkdirAll(publicHtmlLocal, 0755); err != nil {
		return fmt.Errorf("failed to create local directory: %w", err)
	}

	// Report progress
	if progress != nil {
		progress <- common.MigrationProgress{
			Status:      "running",
			CurrentStep: "Downloading files with rsync",
		}
	}

	// Use rsync with compression for fastest transfer
	err := da.sshClient.RsyncDownloadWithKey(ctx, publicHtmlRemote, publicHtmlLocal)
	if err != nil {
		return fmt.Errorf("failed to download domains: %w", err)
	}

	return nil
}

// ExportDatabases dumps every database of the account using DirectAdmin's own MySQL
// credentials (/usr/local/directadmin/conf/mysql.conf), the same way GetAccount lists them.
func (da *DirectAdmin) ExportDatabases(ctx context.Context, username string, outputDir string) ([]common.Database, error) {
	if !da.connected {
		return nil, fmt.Errorf("not connected")
	}
	dbDir := filepath.Join(outputDir, "databases")
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create databases directory: %w", err)
	}

	credScript := `C=/usr/local/directadmin/conf/mysql.conf; grep "^user=" $C | cut -d= -f2-; grep "^passwd=" $C | cut -d= -f2-; grep "^host=" $C | cut -d= -f2-`
	out, err := da.sshClient.RunCommand(ctx, credScript)
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if err != nil || len(lines) < 2 || strings.TrimSpace(lines[0]) == "" {
		return nil, fmt.Errorf("cannot read DirectAdmin MySQL credentials from /usr/local/directadmin/conf/mysql.conf: %v", err)
	}
	mysqlUser, mysqlPass := strings.TrimSpace(lines[0]), strings.TrimSpace(lines[1])
	host := "localhost"
	if len(lines) > 2 && strings.TrimSpace(lines[2]) != "" {
		host = strings.TrimSpace(lines[2])
	}
	auth := fmt.Sprintf("-h %s -u %s -p%s", shq(host), shq(mysqlUser), shq(mysqlPass))

	likePattern := strings.ReplaceAll(username, "_", `\_`) + `\_%`
	listCmd := fmt.Sprintf("mysql %s -N -e %s", auth, shq(fmt.Sprintf("SHOW DATABASES LIKE '%s'", likePattern)))
	out, err = da.sshClient.RunCommand(ctx, listCmd)
	if err != nil {
		return nil, fmt.Errorf("listing databases failed: %v", err)
	}
	dbNames := strings.Fields(out)
	if len(dbNames) == 0 {
		da.logf("info", "No databases found for %s", username)
		return nil, nil
	}

	var databases []common.Database
	for _, dbName := range dbNames {
		var size int64
		sizeOut, _ := da.sshClient.RunCommand(ctx, fmt.Sprintf("mysql %s -N -e %s", auth,
			shq(fmt.Sprintf("SELECT COALESCE(SUM(data_length + index_length),0) FROM information_schema.tables WHERE table_schema='%s'", dbName))))
		if v, err := strconv.ParseInt(strings.TrimSpace(sizeOut), 10, 64); err == nil {
			size = v
		}

		var dbUsers []common.DBUser
		usersOut, _ := da.sshClient.RunCommand(ctx, fmt.Sprintf("mysql %s -N -e %s", auth,
			shq(fmt.Sprintf("SELECT DISTINCT User FROM mysql.db WHERE Db='%s' OR Db='%s'", dbName, strings.ReplaceAll(dbName, "_", `\_`)))))
		for _, u := range strings.Fields(usersOut) {
			dbUsers = append(dbUsers, common.DBUser{Username: u, Host: "localhost"})
		}

		remoteDump := fmt.Sprintf("/tmp/migration_%s_%d.sql.gz", dbName, time.Now().Unix())
		dumpCmd := fmt.Sprintf("set -o pipefail 2>/dev/null; mysqldump %s --single-transaction --quick --skip-lock-tables --routines --triggers --events --default-character-set=utf8mb4 %s 2>&1 | gzip -1 > %s",
			auth, shq(dbName), shq(remoteDump))
		if out, err := da.sshClient.RunCommand(ctx, dumpCmd); err != nil {
			da.sshClient.RunCommand(ctx, "rm -f "+shq(remoteDump))
			return nil, fmt.Errorf("mysqldump of %s failed: %v %s", dbName, err, strings.TrimSpace(out))
		}

		localDump := filepath.Join(dbDir, dbName+".sql.gz")
		if err := da.sshClient.Download(ctx, remoteDump, localDump); err != nil {
			da.sshClient.RunCommand(ctx, "rm -f "+shq(remoteDump))
			return nil, fmt.Errorf("failed to download dump of %s: %w", dbName, err)
		}
		da.sshClient.RunCommand(ctx, "rm -f "+shq(remoteDump))

		st, err := os.Stat(localDump)
		if err != nil || st.Size() < 64 {
			return nil, fmt.Errorf("dump of %s is empty", dbName)
		}
		da.logf("info", "Database %s dumped: %d MB data, %d bytes compressed, users: %s",
			dbName, size/1024/1024, st.Size(), strings.Join(strings.Fields(usersOut), ","))

		databases = append(databases, common.Database{
			Name:    dbName,
			Type:    "mysql",
			Size:    size,
			Users:   dbUsers,
			Charset: "utf8mb4",
		})
	}
	return databases, nil
}

// ExportEmails exports email accounts and data
func (da *DirectAdmin) ExportEmails(ctx context.Context, username string, outputDir string) ([]common.EmailAccount, error) {
	if !da.connected {
		return nil, fmt.Errorf("not connected")
	}

	emailDir := filepath.Join(outputDir, "emails")
	if err := os.MkdirAll(emailDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create emails directory: %w", err)
	}

	// Get account's domain
	account, err := da.GetAccount(ctx, username)
	if err != nil {
		return nil, err
	}

	var emails []common.EmailAccount

	// Get email accounts
	emailListPath := fmt.Sprintf("/etc/virtual/%s/passwd", account.Domain)
	output, err := da.sshClient.RunCommand(ctx, fmt.Sprintf("cat %s 2>/dev/null || echo ''", emailListPath))
	if err != nil || output == "" {
		return emails, nil
	}

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Format: user:password:uid:gid:gecos:home:shell
		parts := strings.Split(line, ":")
		if len(parts) < 1 {
			continue
		}

		emailUser := parts[0]
		email := fmt.Sprintf("%s@%s", emailUser, account.Domain)

		// Get quota info
		quotaPath := fmt.Sprintf("/etc/virtual/%s/quota/%s", account.Domain, emailUser)
		quotaOutput, _ := da.sshClient.RunCommand(ctx, fmt.Sprintf("cat %s 2>/dev/null || echo '0'", quotaPath))
		quota, _ := strconv.ParseInt(strings.TrimSpace(quotaOutput), 10, 64)

		// Get usage
		mailDir := fmt.Sprintf("/home/%s/imap/%s/%s", username, account.Domain, emailUser)
		usageOutput, _ := da.sshClient.RunCommand(ctx, fmt.Sprintf("du -sb %s 2>/dev/null | cut -f1", mailDir))
		usage, _ := strconv.ParseInt(strings.TrimSpace(usageOutput), 10, 64)

		emails = append(emails, common.EmailAccount{
			Email:     email,
			Quota:     quota * 1024 * 1024, // Convert MB to bytes
			QuotaUsed: usage,
		})
	}

	// Export email data (maildir)
	for _, email := range emails {
		parts := strings.Split(email.Email, "@")
		if len(parts) != 2 {
			continue
		}
		emailUser := parts[0]

		mailDir := fmt.Sprintf("/home/%s/imap/%s/%s", username, account.Domain, emailUser)
		localMailDir := filepath.Join(emailDir, emailUser)

		// Download maildir (mailbox contents are not imported yet; kept for future use)
		if err := da.sshClient.DownloadDirectory(ctx, mailDir, localMailDir, nil); err != nil {
			da.logf("warn", "Mailbox contents of %s not downloaded: %v", email.Email, err)
		}
	}

	return emails, nil
}

// exportDomains exports domain configurations
func (da *DirectAdmin) exportDomains(ctx context.Context, username string) ([]common.Domain, error) {
	var domains []common.Domain

	// Get list of domains
	domainsPath := fmt.Sprintf("/usr/local/directadmin/data/users/%s/domains.list", username)
	output, err := da.sshClient.RunCommand(ctx, fmt.Sprintf("cat %s 2>/dev/null || echo ''", domainsPath))
	if err != nil {
		return nil, err
	}

	for _, domainName := range strings.Fields(output) {
		domainName = strings.TrimSpace(domainName)
		if domainName == "" {
			continue
		}

		domain := common.Domain{
			Name:         domainName,
			Type:         "main",
			DocumentRoot: fmt.Sprintf("/home/%s/domains/%s/public_html", username, domainName),
		}

		// Check for SSL
		sslCert, err := da.getSSLCert(ctx, username, domainName)
		if err == nil && sslCert != nil {
			domain.SSL = sslCert
		}

		// Get PHP version
		phpVersion, _ := da.getPHPVersion(ctx, username, domainName)
		domain.PHPVersion = phpVersion

		domains = append(domains, domain)
	}

	// Get addon domains
	addonPath := fmt.Sprintf("/usr/local/directadmin/data/users/%s/domains", username)
	addonOutput, _ := da.sshClient.RunCommand(ctx, fmt.Sprintf("ls %s/*.conf 2>/dev/null || echo ''", addonPath))

	for _, confFile := range strings.Fields(addonOutput) {
		if confFile == "" {
			continue
		}

		// Extract domain name from conf file
		baseName := filepath.Base(confFile)
		domainName := strings.TrimSuffix(baseName, ".conf")

		// Check if already in list
		found := false
		for _, d := range domains {
			if d.Name == domainName {
				found = true
				break
			}
		}
		if found {
			continue
		}

		// Read domain config
		confOutput, _ := da.sshClient.RunCommand(ctx, fmt.Sprintf("cat %s", confFile))

		domain := common.Domain{
			Name:         domainName,
			Type:         "addon",
			DocumentRoot: fmt.Sprintf("/home/%s/domains/%s/public_html", username, domainName),
		}

		// Parse config for additional info
		for _, line := range strings.Split(confOutput, "\n") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) != 2 {
				continue
			}
			key := strings.TrimSpace(parts[0])
			value := strings.TrimSpace(parts[1])

			if key == "php1_select" || key == "php2_select" {
				domain.PHPVersion = value
			}
		}

		domains = append(domains, domain)
	}

	return domains, nil
}

// getSSLCert retrieves SSL certificate for a domain
func (da *DirectAdmin) getSSLCert(ctx context.Context, username, domain string) (*common.SSLCert, error) {
	certPath := fmt.Sprintf("/usr/local/directadmin/data/users/%s/domains/%s.cert", username, domain)
	keyPath := fmt.Sprintf("/usr/local/directadmin/data/users/%s/domains/%s.key", username, domain)
	caPath := fmt.Sprintf("/usr/local/directadmin/data/users/%s/domains/%s.cacert", username, domain)

	cert, err := da.sshClient.RunCommand(ctx, fmt.Sprintf("cat %s 2>/dev/null", certPath))
	if err != nil || cert == "" {
		return nil, fmt.Errorf("no certificate found")
	}

	key, err := da.sshClient.RunCommand(ctx, fmt.Sprintf("cat %s 2>/dev/null", keyPath))
	if err != nil || key == "" {
		return nil, fmt.Errorf("no private key found")
	}

	ca, _ := da.sshClient.RunCommand(ctx, fmt.Sprintf("cat %s 2>/dev/null", caPath))

	// Parse certificate to get expiry date
	expiryOutput, _ := da.sshClient.RunCommand(ctx, fmt.Sprintf(
		"openssl x509 -in %s -noout -enddate 2>/dev/null | cut -d= -f2", certPath))

	var expiresAt time.Time
	if expiryOutput != "" {
		expiresAt, _ = time.Parse("Jan 2 15:04:05 2006 MST", strings.TrimSpace(expiryOutput))
	}

	return &common.SSLCert{
		Certificate: cert,
		PrivateKey:  key,
		CABundle:    ca,
		ExpiresAt:   expiresAt,
	}, nil
}

// getPHPVersion resolves the PHP version of a domain. DirectAdmin stores php1_select=N in the
// domain config, an index into custombuild's phpN_release list (not a version), so it is resolved
// through options.conf; the account's OpenLiteSpeed config is the fallback.
func (da *DirectAdmin) getPHPVersion(ctx context.Context, username, domain string) (string, error) {
	script := fmt.Sprintf(`U=%s; D=%s
conf=/usr/local/directadmin/data/users/$U/domains/$D.conf
opts=/usr/local/directadmin/custombuild/options.conf
sel=$(grep -E '^php1_select=' "$conf" 2>/dev/null | head -1 | cut -d= -f2 | tr -d '[:space:]')
case "$sel" in ''|default|0) sel=1;; esac
case "$sel" in *.*) echo "$sel"; exit 0;; esac
rel=$(grep -E "^php${sel}_release=" "$opts" 2>/dev/null | head -1 | cut -d= -f2 | tr -d '[:space:]')
if [ -n "$rel" ] && [ "$rel" != "no" ]; then echo "$rel"; exit 0; fi
ols=/usr/local/directadmin/data/users/$U/openlitespeed.conf
v=$(grep -oE 'php[0-9]+' "$ols" 2>/dev/null | head -1 | sed 's/php//')
if [ -n "$v" ]; then echo "$v" | sed 's/\(.\)/\1./;s/\.$//'; exit 0; fi
echo default`, daShellQuote(username), daShellQuote(domain))
	output, err := da.sshClient.RunCommand(ctx, script)
	if err != nil {
		return "", err
	}
	version := ""
	for _, line := range strings.Split(output, "\n") {
		if l := strings.TrimSpace(line); l != "" {
			version = l
		}
	}
	if version == "" {
		version = "default"
	}
	return version, nil
}

func daShellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// exportCronJobs exports cron jobs for a user
func (da *DirectAdmin) exportCronJobs(ctx context.Context, username string) ([]common.CronJob, error) {
	output, err := da.sshClient.RunCommand(ctx, fmt.Sprintf("crontab -u %s -l 2>/dev/null || echo ''", username))
	if err != nil {
		return nil, err
	}

	var cronJobs []common.CronJob
	cronRegex := regexp.MustCompile(`^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$`)

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		matches := cronRegex.FindStringSubmatch(line)
		if len(matches) == 7 {
			cronJobs = append(cronJobs, common.CronJob{
				Minute:  matches[1],
				Hour:    matches[2],
				Day:     matches[3],
				Month:   matches[4],
				Weekday: matches[5],
				Command: matches[6],
			})
		}
	}

	return cronJobs, nil
}

// exportDNSRecords exports DNS records for a domain
func (da *DirectAdmin) exportDNSRecords(ctx context.Context, username, domain string) ([]common.DNSRecord, error) {
	zonePath := fmt.Sprintf("/var/named/%s.db", domain)
	output, err := da.sshClient.RunCommand(ctx, fmt.Sprintf("cat %s 2>/dev/null || echo ''", zonePath))
	if err != nil || output == "" {
		return nil, nil
	}

	var records []common.DNSRecord

	// Parse zone file (simplified parser)
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "$") {
			continue
		}

		// Simple parsing for common record types
		parts := strings.Fields(line)
		if len(parts) < 4 {
			continue
		}

		// Try to identify record type
		for i, part := range parts {
			switch strings.ToUpper(part) {
			case "A", "AAAA", "CNAME", "MX", "TXT", "NS", "PTR":
				record := common.DNSRecord{
					Type: strings.ToUpper(part),
					Name: parts[0],
					TTL:  3600, // Default TTL
				}

				// Get TTL if present
				if i > 1 {
					if ttl, err := strconv.Atoi(parts[1]); err == nil {
						record.TTL = ttl
					}
				}

				// Get value
				if i+1 < len(parts) {
					record.Value = strings.Join(parts[i+1:], " ")
				}

				// Get priority for MX records
				if record.Type == "MX" && i+1 < len(parts) {
					if priority, err := strconv.Atoi(parts[i+1]); err == nil {
						record.Priority = priority
						if i+2 < len(parts) {
							record.Value = parts[i+2]
						}
					}
				}

				records = append(records, record)
				break
			}
		}
	}

	return records, nil
}

// CreateAccount creates a new account (for import)
func (da *DirectAdmin) CreateAccount(ctx context.Context, account *common.Account, password string) error {
	return fmt.Errorf("DirectAdmin import not implemented - use Enhance for import")
}

// ImportAccount imports all data for an account
func (da *DirectAdmin) ImportAccount(ctx context.Context, data *common.ExportData, password string, progress chan<- common.MigrationProgress) error {
	return fmt.Errorf("DirectAdmin import not implemented - use Enhance for import")
}

// ImportFiles imports files to an account
func (da *DirectAdmin) ImportFiles(ctx context.Context, username string, sourcePath string, progress chan<- common.MigrationProgress) error {
	return fmt.Errorf("DirectAdmin import not implemented - use Enhance for import")
}

// ImportDatabases imports databases
func (da *DirectAdmin) ImportDatabases(ctx context.Context, username string, databases []common.Database, dumpDir string) error {
	return fmt.Errorf("DirectAdmin import not implemented - use Enhance for import")
}

// ImportEmails imports email accounts
func (da *DirectAdmin) ImportEmails(ctx context.Context, username string, emails []common.EmailAccount) error {
	return fmt.Errorf("DirectAdmin import not implemented - use Enhance for import")
}

// SetupDomain configures a domain
func (da *DirectAdmin) SetupDomain(ctx context.Context, username string, domain *common.Domain) error {
	return fmt.Errorf("DirectAdmin import not implemented - use Enhance for import")
}

// SetupSSL configures SSL for a domain
func (da *DirectAdmin) SetupSSL(ctx context.Context, domain string, cert *common.SSLCert) error {
	return fmt.Errorf("DirectAdmin import not implemented - use Enhance for import")
}

// CleanupTempFiles removes temporary migration files from the server
func (da *DirectAdmin) CleanupTempFiles(ctx context.Context, paths []string) error {
	if !da.connected || da.sshClient == nil {
		return fmt.Errorf("SSH not connected")
	}

	for _, path := range paths {
		// Safety check - only delete from /tmp or specific migration directories
		if !strings.HasPrefix(path, "/tmp/") && !strings.Contains(path, "migration") && !strings.Contains(path, "backup") {
			fmt.Printf("Skipping cleanup of unsafe path: %s\n", path)
			continue
		}

		rmCmd := fmt.Sprintf("rm -rf %s", path)
		if _, err := da.sshClient.RunCommand(ctx, rmCmd); err != nil {
			fmt.Printf("Warning: failed to cleanup %s: %v\n", path, err)
		} else {
			fmt.Printf("Cleaned up: %s\n", path)
		}
	}

	return nil
}

var daUsernameRe = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)

// SetAccountSuspended suspends (or unsuspends) a DirectAdmin user and verifies the result in the
// user's user.conf. It uses the `directadmin suspend-user` CLI and falls back to the local API
// (api-url + CMD_API_SELECT_USERS) on DirectAdmin builds that lack the subcommand.
// It returns false when the account already was in the requested state.
func (da *DirectAdmin) SetAccountSuspended(ctx context.Context, username string, suspend bool) (bool, error) {
	if !da.connected {
		return false, fmt.Errorf("not connected")
	}
	if !daUsernameRe.MatchString(username) {
		return false, fmt.Errorf("invalid DirectAdmin username %q", username)
	}
	want, sub, apiAction := "no", "unsuspend-user", "Unsuspend"
	if suspend {
		want, sub, apiAction = "yes", "suspend-user", "Suspend"
	}
	cur, err := da.accountSuspended(ctx, username)
	if err != nil {
		return false, err
	}
	if cur == want {
		da.logf("info", "Account %s already has suspended=%s on DirectAdmin", username, want)
		return false, nil
	}

	cli := fmt.Sprintf("/usr/local/directadmin/directadmin %s --user=%s 2>&1", sub, shq(username))
	out, err := da.sshClient.RunCommand(ctx, cli)
	if err != nil {
		da.logf("warn", "directadmin %s failed (%v: %s); trying the local DirectAdmin API", sub, err, strings.TrimSpace(out))
		api := fmt.Sprintf(`admin=$(head -n1 /usr/local/directadmin/data/admin/admin.list) && url=$(/usr/local/directadmin/directadmin api-url --user="$admin") && curl -sk -m 60 "$url/CMD_API_SELECT_USERS" --data-urlencode location=CMD_SELECT_USERS --data-urlencode suspend=%s --data-urlencode select0=%s`, apiAction, shq(username))
		out2, err2 := da.sshClient.RunCommand(ctx, api)
		if err2 != nil {
			return false, fmt.Errorf("%s failed via CLI (%s) and via API (%v: %s)", sub, strings.TrimSpace(out), err2, strings.TrimSpace(out2))
		}
		if strings.Contains(out2, "error=1") {
			return false, fmt.Errorf("%s refused by the DirectAdmin API: %s", sub, strings.TrimSpace(out2))
		}
	}

	cur, err = da.accountSuspended(ctx, username)
	if err != nil {
		return false, err
	}
	if cur != want {
		return false, fmt.Errorf("DirectAdmin still reports suspended=%s for %s after %s", cur, username, sub)
	}
	return true, nil
}

// accountSuspended returns the suspended= value ("yes"/"no") of the user's user.conf.
func (da *DirectAdmin) accountSuspended(ctx context.Context, username string) (string, error) {
	conf := fmt.Sprintf("/usr/local/directadmin/data/users/%s/user.conf", username)
	out, err := da.sshClient.RunCommand(ctx, fmt.Sprintf("test -f %s && { grep -E '^suspended=' %s || echo suspended=no; }", shq(conf), shq(conf)))
	if err != nil {
		return "", fmt.Errorf("account %s not found on DirectAdmin (%s): %w", username, conf, err)
	}
	v := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(out), "suspended=")))
	if v == "" {
		v = "no"
	}
	return v, nil
}
