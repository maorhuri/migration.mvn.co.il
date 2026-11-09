// Package cpanel implements cPanel/WHM source operations. It mirrors the DirectAdmin exporter
// (SSH + SFTP + rsync, mysqldump by "<user>_" prefix, maildir), with the discovery commands and
// filesystem layout adapted to cPanel:
//
//   - accounts live under /var/cpanel/users/<user> (one key=value file per account);
//   - the authoritative per-vhost data (document root, PHP version, aliases) is in
//     /var/cpanel/userdata/<user>/<domain> -- there is no DirectAdmin-style /home/<user>/domains
//     tree, so each site's document root is read from its vhost file and its files are copied into
//     the DirectAdmin-shaped files/domains/<domain>/public_html layout the Enhance importer expects;
//   - MySQL is reached as root through root's own ~/.my.cnf (cPanel maintains it);
//   - mail lives under /home/<user>/mail/<domain> and accounts in /home/<user>/etc/<domain>/passwd.
//
// Import is not implemented: like DirectAdmin, cPanel is a source only; the target is always Enhance.
//
// NOTE: the exact paths and the userdata field names follow the standard cPanel layout and are to
// be confirmed against a live server; places that most warrant that check are marked "VERIFY:".
package cpanel

import (
	"context"
	"encoding/json"
	"errors"
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

// CPanel implements the Panel interface for cPanel/WHM servers.
var _ common.Panel = (*CPanel)(nil)

type CPanel struct {
	config    *common.ConnectionConfig
	sshClient *ssh.Client
	password  string
	connected bool
	logFn     func(level, message string)
}

// SetLogger routes module log lines to the given function (in addition to stdout).
func (cp *CPanel) SetLogger(fn func(level, message string)) {
	cp.logFn = fn
	cp.sshClient.SetLogger(fn)
}

func (cp *CPanel) logf(level, format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	fmt.Printf("[cpanel][%s] %s\n", level, msg)
	if cp.logFn != nil {
		cp.logFn(level, msg)
	}
}

func shq(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// New creates a new cPanel panel instance.
func New() *CPanel {
	return &CPanel{sshClient: ssh.NewClient()}
}

// Connect stores the connection config (the SSH session is opened by ConnectWithCredentials).
func (cp *CPanel) Connect(ctx context.Context, config *common.ConnectionConfig) error {
	cp.config = config
	return nil
}

// ConnectWithCredentials connects over SSH (and SFTP) with a password or key.
func (cp *CPanel) ConnectWithCredentials(ctx context.Context, config *common.ConnectionConfig, password string, privateKey []byte) error {
	cp.config = config
	cp.password = password
	if err := cp.sshClient.Connect(ctx, config, password, privateKey); err != nil {
		return fmt.Errorf("failed to connect via SSH: %w", err)
	}
	if err := cp.sshClient.ConnectSFTP(); err != nil {
		return fmt.Errorf("failed to connect via SFTP: %w", err)
	}
	cp.connected = true
	return nil
}

// Disconnect closes the connection.
func (cp *CPanel) Disconnect() error {
	cp.connected = false
	return cp.sshClient.Disconnect()
}

// TestConnection confirms this really is a cPanel/WHM server reachable as this user.
func (cp *CPanel) TestConnection(ctx context.Context) error {
	if !cp.connected {
		return fmt.Errorf("not connected")
	}
	out, err := cp.sshClient.RunCommand(ctx, "cat /usr/local/cpanel/version 2>/dev/null || /usr/local/cpanel/cpanel -V 2>/dev/null")
	if err != nil {
		return fmt.Errorf("failed to read cPanel version: %w", err)
	}
	if strings.TrimSpace(out) == "" {
		return fmt.Errorf("cPanel not found on server (no /usr/local/cpanel/version)")
	}
	return nil
}

// GetPanelType returns the panel type.
func (cp *CPanel) GetPanelType() common.PanelType { return common.PanelTypeCPanel }

// ListAccounts returns all cPanel accounts on the server (one file per account under
// /var/cpanel/users). The "system"/"nobody" pseudo-accounts, if present, are skipped.
func (cp *CPanel) ListAccounts(ctx context.Context) ([]common.Account, error) {
	if !cp.connected {
		return nil, fmt.Errorf("not connected")
	}
	output, err := cp.sshClient.RunCommand(ctx, "ls /var/cpanel/users/ 2>/dev/null")
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}
	var accounts []common.Account
	var errs []string
	for _, username := range strings.Fields(output) {
		switch username {
		case "system", "nobody", "root":
			continue
		}
		account, err := cp.GetAccount(ctx, username)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", username, err))
			continue
		}
		accounts = append(accounts, *account)
	}
	if len(errs) > 0 && len(accounts) == 0 {
		return nil, fmt.Errorf("failed to get any accounts. Errors: %v", errs)
	}
	return accounts, nil
}

// GetAccount returns details for a specific account. Everything is gathered in one SSH round-trip
// (ListAccounts calls this per user), with the parts separated by a sentinel, mirroring the
// DirectAdmin exporter.
func (cp *CPanel) GetAccount(ctx context.Context, username string) (*common.Account, error) {
	if !cp.connected {
		return nil, fmt.Errorf("not connected")
	}
	account := &common.Account{Username: username, Metadata: make(map[string]string)}

	// MySQL is reached as root via root's own ~/.my.cnf, which cPanel maintains. Database names
	// are "<user>_<name>", so "<user>\_%" is the account's set. "_" is escaped in the LIKE pattern
	// so it matches a literal underscore, not any character.
	likePattern := strings.ReplaceAll(username, "_", `\_`) + `\_%`
	output, err := cp.sshClient.RunCommand(ctx, cp.getAccountScript(username, likePattern))
	if err != nil {
		return nil, fmt.Errorf("failed to get account info: %w", err)
	}
	parts := strings.Split(output, "---SEPARATOR---")

	// Part 0: /var/cpanel/users/<user>
	if len(parts) > 0 {
		for _, line := range strings.Split(parts[0], "\n") {
			kv := strings.SplitN(line, "=", 2)
			if len(kv) != 2 {
				continue
			}
			key := strings.TrimSpace(kv[0])
			value := strings.TrimSpace(kv[1])
			switch key {
			case "DNS":
				account.Domain = value
			case "CONTACTEMAIL":
				account.Email = value
			case "PLAN":
				account.Package = value
			case "SUSPENDED":
				account.Suspended = value == "1" || strings.EqualFold(value, "yes")
			}
		}
	}
	if len(parts) > 1 {
		account.DiskUsage = strings.TrimSpace(parts[1])
	}
	if len(parts) > 2 {
		if dbList := strings.TrimSpace(parts[2]); dbList != "" {
			for _, db := range strings.Split(strings.TrimSuffix(dbList, ","), ",") {
				if db = strings.TrimSpace(db); db != "" {
					account.Databases = append(account.Databases, db)
				}
			}
		}
	}
	if len(parts) > 3 {
		if emailList := strings.TrimSpace(parts[3]); emailList != "" {
			for _, local := range strings.Split(strings.TrimSuffix(emailList, ","), ",") {
				if local = strings.TrimSpace(local); local != "" {
					account.EmailAccounts = append(account.EmailAccounts, local+"@"+account.Domain)
				}
			}
		}
	}
	if len(parts) > 4 {
		account.IsWordPress = strings.TrimSpace(parts[4]) == "yes"
	}
	if len(parts) > 5 {
		account.SSLEnabled = strings.TrimSpace(parts[5]) == "yes"
	}
	if len(parts) > 6 {
		if php := mapCPanelPHP(strings.TrimSpace(parts[6])); php != "" {
			account.PHPVersion = php
		}
	}
	if len(parts) > 7 {
		if dbSize := strings.TrimSpace(parts[7]); dbSize != "" && dbSize != "NULL" {
			account.DBSize = dbSize + " MB"
		}
	}
	return account, nil
}

// getAccountScript builds the single discovery script GetAccount runs. Kept separate so the
// (doubly-interpolated) LIKE pattern is spliced through shq exactly once per use.
func (cp *CPanel) getAccountScript(username, likePattern string) string {
	showDBs := shq("SHOW DATABASES LIKE '" + likePattern + "'")
	sumSize := shq("SELECT COALESCE(ROUND(SUM(data_length + index_length)/1024/1024,1),0) FROM information_schema.tables WHERE table_schema LIKE '" + likePattern + "'")
	return fmt.Sprintf(`bash -c '
USER=%s
USERFILE=/var/cpanel/users/$USER
cat "$USERFILE" 2>/dev/null
echo "---SEPARATOR---"
du -sh /home/$USER 2>/dev/null | cut -f1
echo "---SEPARATOR---"
mysql -N -e %s 2>/dev/null | tr "\n" ","
echo "---SEPARATOR---"
DNS=$(grep "^DNS=" "$USERFILE" 2>/dev/null | head -1 | cut -d= -f2)
VHOST=/var/cpanel/userdata/$USER/$DNS
DOCROOT=$(awk -F": " "/^documentroot:/{print \$2; exit}" "$VHOST" 2>/dev/null)
[ -z "$DOCROOT" ] && DOCROOT=/home/$USER/public_html
if [ -f "/home/$USER/etc/$DNS/passwd" ]; then cut -d: -f1 "/home/$USER/etc/$DNS/passwd" 2>/dev/null | tr "\n" ","; fi
echo "---SEPARATOR---"
if [ -f "$DOCROOT/wp-config.php" ]; then echo "yes"; else echo "no"; fi
echo "---SEPARATOR---"
if [ -f "/var/cpanel/userdata/$USER/${DNS}_SSL" ] || [ -f "/var/cpanel/ssl/apache_tls/$DNS/combined" ]; then echo "yes"; else echo "no"; fi
echo "---SEPARATOR---"
awk -F": " "/^phpversion:/{print \$2; exit}" "$VHOST" 2>/dev/null
echo "---SEPARATOR---"
mysql -N -e %s 2>/dev/null || echo "0"
echo "---SEPARATOR---"
'`, shq(username), showDBs, sumSize)
}

// ExportAccount exports all data for an account (same six-step flow as the DirectAdmin exporter).
func (cp *CPanel) ExportAccount(ctx context.Context, username string, outputDir string, progress chan<- common.MigrationProgress) (*common.ExportData, error) {
	if !cp.connected {
		return nil, fmt.Errorf("not connected")
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create output directory: %w", err)
	}
	exportData := &common.ExportData{ExportedAt: time.Now(), SourcePanel: common.PanelTypeCPanel}

	account, err := cp.GetAccount(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}
	exportData.Account = *account

	sendProgress := func(step string, completed, total int) {
		if progress != nil {
			progress <- common.MigrationProgress{Status: "running", CurrentStep: step, TotalSteps: total, CompletedSteps: completed}
		}
	}
	totalSteps := 6
	step := 0

	sendProgress("Exporting domains", step, totalSteps)
	domains, err := cp.exportDomains(ctx, username, account.Domain)
	if err != nil {
		return nil, fmt.Errorf("failed to export domains: %w", err)
	}
	for i := range domains {
		if domains[i].PHPVersion == "" || domains[i].PHPVersion == "default" {
			domains[i].PHPVersion = account.PHPVersion
		}
	}
	exportData.Domains = domains
	step++

	sendProgress("Exporting databases", step, totalSteps)
	databases, err := cp.ExportDatabases(ctx, username, outputDir)
	if err != nil {
		return nil, fmt.Errorf("failed to export databases: %w", err)
	}
	exportData.Databases = databases
	step++

	sendProgress("Exporting emails", step, totalSteps)
	emails, err := cp.ExportEmails(ctx, username, outputDir)
	if err != nil {
		cp.logf("warn", "Failed to export emails: %v", err)
	}
	exportData.Emails = emails
	step++

	sendProgress("Exporting cron jobs", step, totalSteps)
	cronJobs, err := cp.exportCronJobs(ctx, username)
	if err != nil {
		cp.logf("warn", "Failed to export cron jobs: %v", err)
	}
	exportData.CronJobs = cronJobs
	step++

	sendProgress("Exporting DNS records", step, totalSteps)
	dnsRecords, err := cp.exportDNSRecords(ctx, account.Domain)
	if err != nil {
		cp.logf("warn", "Failed to export DNS records: %v", err)
	}
	exportData.DNSRecords = dnsRecords
	step++

	sendProgress("Exporting files", step, totalSteps)
	if err := cp.exportFilesForDomains(ctx, outputDir, domains, progress); err != nil {
		return nil, fmt.Errorf("failed to export files: %w", err)
	}
	exportData.FilesPath = filepath.Join(outputDir, "files")
	step++

	metadataPath := filepath.Join(outputDir, "export_data.json")
	if err := writeJSON(metadataPath, exportData); err != nil {
		return nil, err
	}
	return exportData, nil
}

// ExportFiles satisfies the interface; it re-derives the domains and copies each document root.
func (cp *CPanel) ExportFiles(ctx context.Context, username string, outputDir string, progress chan<- common.MigrationProgress) error {
	if !cp.connected {
		return fmt.Errorf("not connected")
	}
	account, err := cp.GetAccount(ctx, username)
	if err != nil {
		return err
	}
	domains, err := cp.exportDomains(ctx, username, account.Domain)
	if err != nil {
		return err
	}
	return cp.exportFilesForDomains(ctx, outputDir, domains, progress)
}

// exportFilesForDomains copies each domain's document root on the source into the
// files/domains/<domain>/public_html layout the Enhance importer reads (enhance.go looks for files
// at files/domains/<Domain.Name>/public_html). cPanel keeps each site under its own document root
// rather than a single /home/<user>/domains tree, so each is fetched individually.
//
// TODO(cpanel, verify-with-live-box): an addon domain's document root can be nested inside the
// main domain's (e.g. /home/user/public_html/shop). Here each is copied independently, so such
// files are copied into both their own site and the parent's -- correct but duplicated. Once the
// real layout is confirmed, exclude a nested child from its parent's copy.
func (cp *CPanel) exportFilesForDomains(ctx context.Context, outputDir string, domains []common.Domain, progress chan<- common.MigrationProgress) error {
	filesDir := filepath.Join(outputDir, "files")
	if err := os.MkdirAll(filesDir, 0755); err != nil {
		return fmt.Errorf("failed to create files directory: %w", err)
	}

	// Sum the sizes up front so progress has a total.
	var total int64
	for _, d := range domains {
		if d.DocumentRoot == "" {
			continue
		}
		if n, err := cp.sshClient.RemoteDirSize(ctx, d.DocumentRoot); err == nil {
			total += n
		}
	}
	const stepName = "Downloading files with rsync"
	reporter := common.NewTransferReporter(stepName, total, progress, func(level, msg string) { cp.logf(level, "%s", msg) })
	reporter.Start()
	defer reporter.Finish()

	for _, d := range domains {
		if d.DocumentRoot == "" {
			cp.logf("warn", "Domain %s has no document root; skipping its files", d.Name)
			continue
		}
		localDocRoot := filepath.Join(filesDir, "domains", d.Name, "public_html")
		if err := os.MkdirAll(localDocRoot, 0755); err != nil {
			return fmt.Errorf("failed to create local directory for %s: %w", d.Name, err)
		}
		err := cp.sshClient.RsyncDownloadWithKey(ctx, d.DocumentRoot, localDocRoot, reporter.Feed())
		var partial *ssh.RsyncPartialError
		if errors.As(err, &partial) {
			cp.logf("warn", "Some files changed or vanished on the source while copying %s (rsync exit 24); running a second pass. %s", d.Name, partial.Tail)
			err = cp.sshClient.RsyncDownloadWithKey(ctx, d.DocumentRoot, localDocRoot, reporter.Feed())
			if errors.As(err, &partial) {
				cp.logf("warn", "Files for %s are still being rewritten on the source; continuing with what was copied. %s", d.Name, partial.Tail)
				err = nil
			}
		}
		if err != nil {
			return fmt.Errorf("failed to download files for %s (%s): %w", d.Name, d.DocumentRoot, err)
		}
	}
	return nil
}

// ExportDatabases dumps every database of the account as root (cPanel keeps root's ~/.my.cnf), the
// same way GetAccount lists them.
func (cp *CPanel) ExportDatabases(ctx context.Context, username string, outputDir string) ([]common.Database, error) {
	if !cp.connected {
		return nil, fmt.Errorf("not connected")
	}
	dbDir := filepath.Join(outputDir, "databases")
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create databases directory: %w", err)
	}

	likePattern := strings.ReplaceAll(username, "_", `\_`) + `\_%`
	out, err := cp.mysqlQuery(ctx, fmt.Sprintf("SHOW DATABASES LIKE '%s'", likePattern))
	if err != nil {
		return nil, fmt.Errorf("listing databases failed: %v", err)
	}
	dbNames := strings.Fields(out)
	if len(dbNames) == 0 {
		cp.logf("info", "No databases found for %s", username)
		return nil, nil
	}

	var databases []common.Database
	for _, dbName := range dbNames {
		var size int64
		sizeOut, _ := cp.mysqlQuery(ctx, fmt.Sprintf("SELECT COALESCE(SUM(data_length + index_length),0) FROM information_schema.tables WHERE table_schema='%s'", dbName))
		if v, err := strconv.ParseInt(strings.TrimSpace(sizeOut), 10, 64); err == nil {
			size = v
		}

		var dbUsers []common.DBUser
		usersOut, _ := cp.mysqlQuery(ctx, fmt.Sprintf("SELECT DISTINCT User FROM mysql.db WHERE Db='%s' OR Db='%s'", dbName, strings.ReplaceAll(dbName, "_", `\_`)))
		for _, u := range strings.Fields(usersOut) {
			dbUsers = append(dbUsers, common.DBUser{Username: u, Host: "localhost"})
		}

		// mysqldump's stdout must stay pure SQL for gzip; its stderr (a real error, or a renamed-
		// binary "Deprecated program name" notice) stays on the command's own stderr, which
		// RunCommand captures into `out` for the failure case. pipefail keeps mysqldump's exit code.
		remoteDump := fmt.Sprintf("/tmp/migration_%s_%d.sql.gz", dbName, time.Now().UnixNano())
		ignore := ""
		var skipped []string
		for {
			dumpCmd := fmt.Sprintf("set -o pipefail 2>/dev/null; mysqldump --single-transaction --quick --skip-lock-tables --routines --triggers --events --default-character-set=utf8mb4%s %s | gzip -1 > %s",
				ignore, shq(dbName), shq(remoteDump))
			out, err := cp.sshClient.RunCommand(ctx, dumpCmd)
			if err == nil {
				break
			}
			if table := common.BrokenDumpTable(out); table != "" {
				if common.IsEssentialTable(table) {
					cp.sshClient.RunCommand(ctx, "rm -f "+shq(remoteDump))
					return nil, fmt.Errorf("database %s: table %s cannot be read on the source (%s) and the site cannot work without it; repair the source database before migrating", dbName, table, strings.TrimSpace(out))
				}
				if len(skipped) < common.MaxBrokenDumpTables {
					cp.logf("warn", "Database %s: table %s cannot be read on the source (%s); it is left out of the migration", dbName, table, strings.TrimSpace(out))
					skipped = append(skipped, table)
					ignore += " --ignore-table=" + shq(dbName+"."+table)
					continue
				}
			}
			cp.sshClient.RunCommand(ctx, "rm -f "+shq(remoteDump))
			return nil, fmt.Errorf("mysqldump of %s failed: %v %s", dbName, err, strings.TrimSpace(out))
		}

		localDump := filepath.Join(dbDir, dbName+".sql.gz")
		if err := cp.sshClient.Download(ctx, remoteDump, localDump); err != nil {
			cp.sshClient.RunCommand(ctx, "rm -f "+shq(remoteDump))
			return nil, fmt.Errorf("failed to download dump of %s: %w", dbName, err)
		}
		cp.sshClient.RunCommand(ctx, "rm -f "+shq(remoteDump))

		st, err := os.Stat(localDump)
		if err != nil || st.Size() < 64 {
			return nil, fmt.Errorf("dump of %s is empty", dbName)
		}
		cp.logf("info", "Database %s dumped: %d MB data, %d bytes compressed, users: %s", dbName, size/1024/1024, st.Size(), strings.Join(strings.Fields(usersOut), ","))

		databases = append(databases, common.Database{Name: dbName, Type: "mysql", Size: size, Users: dbUsers, Charset: "utf8mb4"})
	}
	return databases, nil
}

// mysqlQuery runs one statement as root (root's ~/.my.cnf) and returns header-less output. Stderr
// is discarded: some servers' mysql binary is renamed (MariaDB deprecating "mysql") and prints a
// warning on every run that would otherwise be parsed as data.
func (cp *CPanel) mysqlQuery(ctx context.Context, sql string) (string, error) {
	return cp.sshClient.RunCommand(ctx, fmt.Sprintf("mysql -N -e %s 2>/dev/null", shq(sql)))
}

// ExportEmails lists the account's email addresses (per-domain /home/<user>/etc/<domain>/passwd)
// with maildir usage. The maildirs themselves travel with the home directory in the files step.
func (cp *CPanel) ExportEmails(ctx context.Context, username string, outputDir string) ([]common.EmailAccount, error) {
	if !cp.connected {
		return nil, fmt.Errorf("not connected")
	}
	account, err := cp.GetAccount(ctx, username)
	if err != nil {
		return nil, err
	}
	var emails []common.EmailAccount

	// Every domain of the account can hold mailboxes; /home/<user>/etc/<domain>/passwd lists them.
	domains := append([]string{account.Domain}, account.AddonDomains...)
	seen := map[string]bool{}
	for _, domain := range domains {
		if domain == "" || seen[domain] {
			continue
		}
		seen[domain] = true
		passwdPath := fmt.Sprintf("/home/%s/etc/%s/passwd", username, domain)
		output, err := cp.sshClient.RunCommand(ctx, fmt.Sprintf("cat %s 2>/dev/null || echo ''", shq(passwdPath)))
		if err != nil || strings.TrimSpace(output) == "" {
			continue
		}
		for _, line := range strings.Split(output, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			local := strings.SplitN(line, ":", 2)[0]
			if local == "" {
				continue
			}
			mailDir := fmt.Sprintf("/home/%s/mail/%s/%s", username, domain, local)
			usageOut, _ := cp.sshClient.RunCommand(ctx, fmt.Sprintf("du -sb %s 2>/dev/null | cut -f1", shq(mailDir)))
			usage, _ := strconv.ParseInt(strings.TrimSpace(usageOut), 10, 64)
			emails = append(emails, common.EmailAccount{Email: local + "@" + domain, QuotaUsed: usage})
		}
	}
	return emails, nil
}

// exportDomains reads the account's vhost files under /var/cpanel/userdata/<user>. Each vhost file
// (excluding main/cache and the *_SSL variants) is one site, with its real servername, document
// root, PHP version and aliases -- which sidesteps cPanel's addon/parked/subdomain bookkeeping.
func (cp *CPanel) exportDomains(ctx context.Context, username, mainDomain string) ([]common.Domain, error) {
	// For each vhost file emit one pipe-delimited line: VHOST|<file>|<servername>|<documentroot>|<serveralias>|<phpversion>
	script := fmt.Sprintf(`U=%s
DIR=/var/cpanel/userdata/$U
for f in "$DIR"/*; do
  b=$(basename "$f")
  case "$b" in main|cache|*.cache|*_SSL) continue;; esac
  [ -f "$f" ] || continue
  sn=$(awk -F": " '/^servername:/{print $2; exit}' "$f")
  dr=$(awk -F": " '/^documentroot:/{print $2; exit}' "$f")
  sa=$(awk -F": " '/^serveralias:/{sub(/^serveralias: /,""); print; exit}' "$f")
  ph=$(awk -F": " '/^phpversion:/{print $2; exit}' "$f")
  [ -z "$sn" ] && sn="$b"
  echo "VHOST|$b|$sn|$dr|$sa|$ph"
done`, shq(username))
	output, err := cp.sshClient.RunCommand(ctx, script)
	if err != nil {
		return nil, err
	}

	var domains []common.Domain
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "VHOST|") {
			continue
		}
		f := strings.SplitN(line, "|", 6)
		if len(f) < 6 {
			continue
		}
		servername := strings.TrimSpace(f[2])
		docroot := strings.TrimSpace(f[3])
		serveralias := strings.TrimSpace(f[4])
		php := mapCPanelPHP(strings.TrimSpace(f[5]))
		if servername == "" {
			continue
		}

		dtype := "addon"
		if strings.EqualFold(servername, mainDomain) {
			dtype = "main"
		}
		if docroot == "" {
			docroot = fmt.Sprintf("/home/%s/public_html", username)
		}

		// serveralias is a space-separated list (typically "www.<domain>" plus parked domains).
		// The plain "www." alias of the site itself is not a separate domain worth recording.
		var aliases []string
		for _, a := range strings.Fields(serveralias) {
			a = strings.TrimSpace(a)
			if a == "" || strings.EqualFold(a, servername) || strings.EqualFold(a, "www."+servername) {
				continue
			}
			aliases = append(aliases, a)
		}

		domain := common.Domain{Name: servername, Type: dtype, DocumentRoot: docroot, PHPVersion: php, Aliases: aliases}
		if cert, err := cp.getSSLCert(ctx, servername); err == nil && cert != nil {
			domain.SSL = cert
		}
		domains = append(domains, domain)
	}
	return domains, nil
}

// getSSLCert reads the installed TLS material for a domain from cPanel's combined PEM file
// (/var/cpanel/ssl/apache_tls/<domain>/combined: private key + certificate + CA chain), best-effort.
func (cp *CPanel) getSSLCert(ctx context.Context, domain string) (*common.SSLCert, error) {
	path := fmt.Sprintf("/var/cpanel/ssl/apache_tls/%s/combined", domain)
	out, err := cp.sshClient.RunCommand(ctx, fmt.Sprintf("cat %s 2>/dev/null", shq(path)))
	if err != nil || strings.TrimSpace(out) == "" {
		return nil, fmt.Errorf("no certificate found")
	}
	key, cert, ca := splitPEMBundle(out)
	if cert == "" || key == "" {
		return nil, fmt.Errorf("incomplete certificate bundle")
	}
	var expiresAt time.Time
	if exp, err := cp.sshClient.RunCommand(ctx, fmt.Sprintf("openssl x509 -in %s -noout -enddate 2>/dev/null | cut -d= -f2", shq(path))); err == nil {
		expiresAt, _ = time.Parse("Jan 2 15:04:05 2006 MST", strings.TrimSpace(exp))
	}
	return &common.SSLCert{Certificate: cert, PrivateKey: key, CABundle: ca, ExpiresAt: expiresAt}, nil
}

// exportCronJobs exports the user's crontab (cPanel, like DirectAdmin, uses /var/spool/cron).
func (cp *CPanel) exportCronJobs(ctx context.Context, username string) ([]common.CronJob, error) {
	output, err := cp.sshClient.RunCommand(ctx, fmt.Sprintf("crontab -u %s -l 2>/dev/null || echo ''", shq(username)))
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
		if m := cronRegex.FindStringSubmatch(line); len(m) == 7 {
			cronJobs = append(cronJobs, common.CronJob{Minute: m[1], Hour: m[2], Day: m[3], Month: m[4], Weekday: m[5], Command: m[6]})
		}
	}
	return cronJobs, nil
}

// exportDNSRecords parses the domain's BIND zone file (cPanel keeps zones in /var/named).
func (cp *CPanel) exportDNSRecords(ctx context.Context, domain string) ([]common.DNSRecord, error) {
	if domain == "" {
		return nil, nil
	}
	zonePath := fmt.Sprintf("/var/named/%s.db", domain)
	output, err := cp.sshClient.RunCommand(ctx, fmt.Sprintf("cat %s 2>/dev/null || echo ''", shq(zonePath)))
	if err != nil || strings.TrimSpace(output) == "" {
		return nil, nil
	}
	var records []common.DNSRecord
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "$") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 4 {
			continue
		}
		for i, part := range parts {
			switch strings.ToUpper(part) {
			case "A", "AAAA", "CNAME", "MX", "TXT", "NS", "PTR", "SRV", "CAA":
				record := common.DNSRecord{Type: strings.ToUpper(part), Name: parts[0], TTL: 3600}
				if i > 1 {
					if ttl, err := strconv.Atoi(parts[1]); err == nil {
						record.TTL = ttl
					}
				}
				if i+1 < len(parts) {
					record.Value = strings.Join(parts[i+1:], " ")
				}
				if record.Type == "MX" && i+1 < len(parts) {
					if priority, err := strconv.Atoi(parts[i+1]); err == nil {
						record.Priority = priority
						if i+2 < len(parts) {
							record.Value = parts[i+2]
						}
					}
				}
				records = append(records, record)
			}
			if len(records) > 0 && records[len(records)-1].Name == parts[0] {
				break
			}
		}
	}
	return records, nil
}

var cpUsernameRe = regexp.MustCompile(`^[a-z0-9]{1,16}$`)

// SetAccountSuspended suspends (or unsuspends) a cPanel account via whmapi1 and verifies the
// result. Returns false when the account already was in the requested state.
func (cp *CPanel) SetAccountSuspended(ctx context.Context, username string, suspend bool) (bool, error) {
	if !cp.connected {
		return false, fmt.Errorf("not connected")
	}
	if !cpUsernameRe.MatchString(username) {
		return false, fmt.Errorf("invalid cPanel username %q", username)
	}
	cur, err := cp.accountSuspended(ctx, username)
	if err != nil {
		return false, err
	}
	if cur == suspend {
		cp.logf("info", "Account %s already has suspended=%v on cPanel", username, suspend)
		return false, nil
	}
	call := "unsuspendacct"
	if suspend {
		call = "suspendacct"
	}
	out, err := cp.sshClient.RunCommand(ctx, fmt.Sprintf("whmapi1 %s user=%s 2>&1", call, shq(username)))
	if err != nil {
		return false, fmt.Errorf("whmapi1 %s failed (%v): %s", call, err, strings.TrimSpace(out))
	}
	if strings.Contains(out, "result: 0") || strings.Contains(strings.ToLower(out), "error") {
		return false, fmt.Errorf("whmapi1 %s refused: %s", call, strings.TrimSpace(out))
	}
	cur, err = cp.accountSuspended(ctx, username)
	if err != nil {
		return false, err
	}
	if cur != suspend {
		return false, fmt.Errorf("cPanel still reports suspended=%v for %s after %s", cur, username, call)
	}
	return true, nil
}

// accountSuspended reports whether the account is currently suspended (cPanel drops a marker file
// at /var/cpanel/suspended/<user>; the users file also carries SUSPENDED=).
func (cp *CPanel) accountSuspended(ctx context.Context, username string) (bool, error) {
	out, err := cp.sshClient.RunCommand(ctx, fmt.Sprintf("if [ -f /var/cpanel/suspended/%s ]; then echo yes; else grep -E '^SUSPENDED=' /var/cpanel/users/%s 2>/dev/null | head -1 | cut -d= -f2; fi", shq(username), shq(username)))
	if err != nil {
		return false, fmt.Errorf("account %s not found on cPanel: %w", username, err)
	}
	v := strings.ToLower(strings.TrimSpace(out))
	return v == "yes" || v == "1", nil
}

// CleanupTempFiles removes temporary migration files from the server.
func (cp *CPanel) CleanupTempFiles(ctx context.Context, paths []string) error {
	if !cp.connected || cp.sshClient == nil {
		return fmt.Errorf("SSH not connected")
	}
	for _, path := range paths {
		if !strings.HasPrefix(path, "/tmp/") && !strings.Contains(path, "migration") && !strings.Contains(path, "backup") {
			fmt.Printf("Skipping cleanup of unsafe path: %s\n", path)
			continue
		}
		if _, err := cp.sshClient.RunCommand(ctx, fmt.Sprintf("rm -rf %s", path)); err != nil {
			fmt.Printf("Warning: failed to cleanup %s: %v\n", path, err)
		}
	}
	return nil
}

// --- Import side: cPanel is a source only; the target is always Enhance. ---

func (cp *CPanel) CreateAccount(ctx context.Context, account *common.Account, password string) error {
	return fmt.Errorf("cPanel import not implemented - use Enhance for import")
}
func (cp *CPanel) ImportAccount(ctx context.Context, data *common.ExportData, password string, progress chan<- common.MigrationProgress) error {
	return fmt.Errorf("cPanel import not implemented - use Enhance for import")
}
func (cp *CPanel) ImportFiles(ctx context.Context, username string, sourcePath string, progress chan<- common.MigrationProgress) error {
	return fmt.Errorf("cPanel import not implemented - use Enhance for import")
}
func (cp *CPanel) ImportDatabases(ctx context.Context, username string, databases []common.Database, dumpDir string) error {
	return fmt.Errorf("cPanel import not implemented - use Enhance for import")
}
func (cp *CPanel) ImportEmails(ctx context.Context, username string, emails []common.EmailAccount) error {
	return fmt.Errorf("cPanel import not implemented - use Enhance for import")
}
func (cp *CPanel) SetupDomain(ctx context.Context, username string, domain *common.Domain) error {
	return fmt.Errorf("cPanel import not implemented - use Enhance for import")
}
func (cp *CPanel) SetupSSL(ctx context.Context, domain string, cert *common.SSLCert) error {
	return fmt.Errorf("cPanel import not implemented - use Enhance for import")
}

// writeJSON writes v to path as indented JSON (the export metadata file).
func writeJSON(path string, v interface{}) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("failed to create metadata file: %w", err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return fmt.Errorf("failed to write metadata: %w", err)
	}
	return nil
}

// mapCPanelPHP converts a cPanel PHP identifier ("ea-php81", "alt-php74") to the dotted form the
// rest of the tool uses ("8.1"). Pass-through for an already-dotted or empty value.
func mapCPanelPHP(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if strings.Contains(s, ".") {
		return s
	}
	digits := regexp.MustCompile(`[0-9]+`).FindString(s)
	if len(digits) >= 2 {
		return digits[:1] + "." + digits[1:]
	}
	return s
}

// splitPEMBundle separates a concatenated PEM bundle into (privateKey, certificate, caBundle).
// The first CERTIFICATE block is the leaf; any further CERTIFICATE blocks are the CA chain.
func splitPEMBundle(bundle string) (key, cert, ca string) {
	blockRe := regexp.MustCompile(`(?s)-----BEGIN ([A-Z0-9 ]+)-----.*?-----END [A-Z0-9 ]+-----`)
	for _, m := range blockRe.FindAllStringSubmatch(bundle, -1) {
		block := strings.TrimSpace(m[0])
		label := m[1]
		switch {
		case strings.Contains(label, "PRIVATE KEY"):
			if key == "" {
				key = block
			}
		case label == "CERTIFICATE":
			if cert == "" {
				cert = block
			} else if ca == "" {
				ca = block
			} else {
				ca += "\n" + block
			}
		}
	}
	return key, cert, ca
}
