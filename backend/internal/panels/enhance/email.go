package enhance

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/migration-tool/backend/internal/panels/common"
)

// noReplyFor returns the per-site sender address no-reply@<site domain> (the "www." prefix and
// casing are normalised away). This is the only From address used -- there is nothing to configure.
func noReplyFor(domain string) string {
	domain = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(domain), "www."))
	return "no-reply@" + domain
}

// BuildFluentSMTPSettingsJSON builds the JSON value FluentSMTP stores in the WordPress option
// `fluentmail-settings` for one site. It defines a single SMTP connection pointed at the server's
// OWN local mail transport (localhost:25, no auth, no encryption) -- i.e. mail leaves from the
// target server itself over port 25, exactly like PHP mail() -- sending as no-reply@<site domain>
// with the From address forced. There is no central relay and nothing for the operator to set.
// The shape mirrors what FluentSMTP's own settings screen writes (connections / mappings / misc
// with provider "smtp"); the exact field set should be confirmed against a live FluentSMTP install.
func BuildFluentSMTPSettingsJSON(fromEmail string) (string, error) {
	fromEmail = strings.ToLower(strings.TrimSpace(fromEmail))
	if fromEmail == "" {
		return "", fmt.Errorf("a from-email is required to configure FluentSMTP")
	}

	providerSettings := map[string]string{
		"sender_name":      "",
		"sender_email":     fromEmail,
		"force_from_name":  "no",
		"force_from_email": "yes",
		"return_path":      "no",
		"mailer":           "smtp",
		"provider":         "smtp",
		"smtp_host":        "localhost",
		"smtp_port":        "25",
		"auth":             "no",
		"username":         "",
		"password":         "",
		"encryption":       "none",
		"auto_tls":         "no",
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

// ConfigureFluentSMTP installs and activates the FluentSMTP plugin on each migrated WordPress site
// and points it at the server's own local mail (localhost:25) as no-reply@<site domain>. It is
// idempotent: an already-installed plugin is only re-activated, and the `fluentmail-settings`
// option is overwritten rather than appended to. Sites without a wp-config.php are skipped.
// Returns one summary line per site acted on. Zero operator configuration.
func (e *Enhance) ConfigureFluentSMTP(ctx context.Context, domains []common.Domain) ([]string, error) {
	orgID, err := e.orgID()
	if err != nil {
		return nil, err
	}
	if e.node == nil {
		return nil, fmt.Errorf("not connected to the cluster node")
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
		fromEmail := noReplyFor(domain)
		jsonStr, err := BuildFluentSMTPSettingsJSON(fromEmail)
		if err != nil {
			e.warnf("FluentSMTP %s: %v", domain, err)
			continue
		}
		if out, uerr := e.wpCLI(ctx, ws, fmt.Sprintf("option update fluentmail-settings %s --format=json", shq(jsonStr))); uerr != nil {
			e.warnf("FluentSMTP %s: could not write the settings: %v %s", domain, uerr, lastLines(out, 2))
			continue
		}
		e.logf("info", "FluentSMTP %s: configured to send via the local server (localhost:25) as %s", domain, fromEmail)
		summary = append(summary, fmt.Sprintf("%s: FluentSMTP -> localhost:25 (from %s)", domain, fromEmail))
	}
	return summary, nil
}
