package enhance

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/migration-tool/backend/internal/panels/common"
)

// FluentSMTPConfig is the central outbound-email configuration applied to each migrated
// WordPress site. FromEmail is a pattern resolved per site (see resolveFromEmail): empty ->
// no-reply@<site-domain>, "local@" or a bare local part -> local@<site-domain>, a full address
// -> used verbatim for every site.
type FluentSMTPConfig struct {
	Host       string
	Port       string
	Encryption string // tls | ssl | none
	AuthUser   string
	Password   string
	FromName   string
	FromEmail  string
}

// resolveFromEmail turns the operator's from-email pattern into a concrete sender address for one
// site's domain. A full address (non-empty local and domain parts) is used as-is; otherwise the
// local part (default "no-reply") is combined with the site's own domain.
func resolveFromEmail(pattern, domain string) string {
	domain = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(domain), "www."))
	p := strings.TrimSpace(pattern)
	if p == "" {
		return "no-reply@" + domain
	}
	if strings.HasSuffix(p, "@") { // "no-reply@" pattern
		return strings.ToLower(p) + domain
	}
	if i := strings.Index(p, "@"); i > 0 && i < len(p)-1 { // full address local@domain
		return strings.ToLower(p)
	}
	// bare local part (or a malformed "@x"): use as the local part on the site's domain
	return strings.ToLower(strings.Trim(p, "@")) + "@" + domain
}

// BuildFluentSMTPSettingsJSON builds the JSON value FluentSMTP stores in the WordPress option
// `fluentmail-settings`. It defines a single SMTP connection keyed by the sender email, maps that
// sender to the connection, and marks it the default connection, so WordPress sends all mail
// through the central SMTP host. The shape mirrors what FluentSMTP's own settings screen writes
// (connections / mappings / misc with provider "smtp"); the exact field set should be confirmed
// against a live FluentSMTP install.
func BuildFluentSMTPSettingsJSON(fromEmail, fromName, host, port, encryption, authUser, password string) (string, error) {
	fromEmail = strings.ToLower(strings.TrimSpace(fromEmail))
	if fromEmail == "" {
		return "", fmt.Errorf("a from-email is required to configure FluentSMTP")
	}
	if host == "" {
		return "", fmt.Errorf("an SMTP host is required to configure FluentSMTP")
	}
	if port == "" {
		port = "587"
	}
	switch encryption {
	case "tls", "ssl", "none":
	case "":
		encryption = "tls"
	default:
		encryption = "tls"
	}
	auth := "yes"
	if strings.TrimSpace(authUser) == "" {
		auth = "no"
	}

	providerSettings := map[string]string{
		"sender_name":      fromName,
		"sender_email":     fromEmail,
		"force_from_name":  "no",
		"force_from_email": "yes",
		"return_path":      "no",
		"mailer":           "smtp",
		"provider":         "smtp",
		"smtp_host":        host,
		"smtp_port":        port,
		"auth":             auth,
		"username":         authUser,
		"password":         password,
		"encryption":       encryption,
		"auto_tls":         "yes",
		"key_store":        "db",
	}

	// Key the connection by the sender email so re-running overwrites the same connection rather
	// than piling up duplicates (the whole option is replaced on each run anyway).
	connectionKey := fromEmail
	settings := map[string]interface{}{
		"connections": map[string]interface{}{
			connectionKey: map[string]interface{}{
				"title":             fromEmail,
				"provider_settings": providerSettings,
			},
		},
		"mappings": map[string]string{
			fromEmail: connectionKey,
		},
		"misc": map[string]interface{}{
			"log_emails":              "yes",
			"log_saved_interval_days": "7",
			"default_connection":      fromEmail,
		},
	}

	b, err := json.Marshal(settings)
	if err != nil {
		return "", fmt.Errorf("could not encode FluentSMTP settings: %w", err)
	}
	return string(b), nil
}

// ConfigureFluentSMTP installs and activates the FluentSMTP plugin on each migrated WordPress
// site and points it at the central SMTP host. It is idempotent: an already-installed plugin is
// only re-activated, and the `fluentmail-settings` option is overwritten rather than appended to.
// Sites without a wp-config.php are skipped. Returns one summary line per site acted on.
func (e *Enhance) ConfigureFluentSMTP(ctx context.Context, domains []common.Domain, cfg FluentSMTPConfig) ([]string, error) {
	orgID, err := e.orgID()
	if err != nil {
		return nil, err
	}
	if e.node == nil {
		return nil, fmt.Errorf("not connected to the cluster node")
	}
	if strings.TrimSpace(cfg.Host) == "" {
		return nil, fmt.Errorf("no SMTP host is configured; set central SMTP settings before configuring FluentSMTP")
	}
	if _, err := e.nodeRun(ctx, "test -x /usr/bin/wp-cli"); err != nil {
		return nil, fmt.Errorf("WP-CLI is not installed on node %s; cannot configure FluentSMTP", e.nodeHost)
	}

	var summary []string
	for _, d := range domains {
		domain := d.Name
		if d.TargetDomain != "" {
			domain = d.TargetDomain
		}
		ws, err := e.getWebsiteByDomain(ctx, orgID, domain)
		if err != nil {
			e.warnf("FluentSMTP %s: %v", domain, err)
			continue
		}
		if err := e.resolveWebsitePaths(ctx, ws); err != nil {
			e.warnf("FluentSMTP %s: %v", domain, err)
			continue
		}
		if _, err := e.nodeRun(ctx, "test -f "+shq(ws.DocRoot+"/wp-config.php")); err != nil {
			e.logf("info", "FluentSMTP %s: no wp-config.php at the web root; not a WordPress site, skipping", domain)
			continue
		}

		// 1. Ensure the plugin is installed and active (idempotent).
		if _, err := e.wpCLI(ctx, ws, "plugin is-installed fluent-smtp"); err != nil {
			if out, ierr := e.wpCLI(ctx, ws, "plugin install fluent-smtp --activate"); ierr != nil {
				e.warnf("FluentSMTP %s: could not install the plugin: %v %s", domain, ierr, lastLines(out, 2))
				continue
			}
			e.logf("info", "FluentSMTP %s: plugin installed and activated", domain)
		} else {
			if out, aerr := e.wpCLI(ctx, ws, "plugin activate fluent-smtp"); aerr != nil {
				e.warnf("FluentSMTP %s: plugin is installed but could not be activated: %v %s", domain, aerr, lastLines(out, 2))
				continue
			}
			e.logf("info", "FluentSMTP %s: plugin already installed; ensured active", domain)
		}

		// 2. Write the connection settings (overwrites, so re-running updates in place).
		fromEmail := resolveFromEmail(cfg.FromEmail, domain)
		jsonStr, err := BuildFluentSMTPSettingsJSON(fromEmail, cfg.FromName, cfg.Host, cfg.Port, cfg.Encryption, cfg.AuthUser, cfg.Password)
		if err != nil {
			e.warnf("FluentSMTP %s: %v", domain, err)
			continue
		}
		if out, uerr := e.wpCLI(ctx, ws, fmt.Sprintf("option update fluentmail-settings %s --format=json", shq(jsonStr))); uerr != nil {
			e.warnf("FluentSMTP %s: could not write the settings: %v %s", domain, uerr, lastLines(out, 2))
			continue
		}
		e.logf("info", "FluentSMTP %s: configured to send through %s:%s as %s", domain, cfg.Host, cfg.Port, fromEmail)
		summary = append(summary, fmt.Sprintf("%s: FluentSMTP -> %s (from %s)", domain, cfg.Host, fromEmail))
	}
	return summary, nil
}
