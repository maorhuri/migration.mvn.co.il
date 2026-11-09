package migration

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/migration-tool/backend/internal/cloudflare"
	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/panels/enhance"
	"github.com/migration-tool/backend/internal/storage"
)

// EmailSetupResult summarizes an "Email setup" run: FluentSMTP configured per site, and SPF/DMARC
// ensured in DNS. Every line here is also written to the migration log.
type EmailSetupResult struct {
	Domains      []string `json:"domains"`
	FluentSMTP   []string `json:"fluent_smtp,omitempty"`   // per-site FluentSMTP summary lines
	SPFEnsured   []string `json:"spf_ensured,omitempty"`   // per-zone SPF lines
	DMARCEnsured []string `json:"dmarc_ensured,omitempty"` // per-zone DMARC lines
	DNSSkipped   string   `json:"dns_skipped,omitempty"`   // reason SPF/DMARC were not touched
}

// ---------------------------------------------------------------------------
// SPF / DMARC record building (pure, unit-tested)
// ---------------------------------------------------------------------------

// spfTerms splits an operator-provided extra SPF string into individual mechanisms/modifiers.
func spfTerms(extra string) []string { return strings.Fields(strings.TrimSpace(extra)) }

// isAllMech reports whether a token is an SPF "all" mechanism (the record's trailing match-all).
func isAllMech(tok string) bool {
	switch strings.ToLower(tok) {
	case "all", "+all", "-all", "~all", "?all":
		return true
	}
	return false
}

// buildSPF builds a fresh SPF record authorizing the target IP plus any operator-configured extra
// term(s), ending in a soft-fail (~all).
func buildSPF(targetIP, extra string) string {
	parts := []string{"v=spf1"}
	if strings.TrimSpace(targetIP) != "" {
		parts = append(parts, "ip4:"+strings.TrimSpace(targetIP))
	}
	parts = append(parts, spfTerms(extra)...)
	parts = append(parts, "~all")
	return strings.Join(parts, " ")
}

// mergeSPF ensures an SPF record authorizes the target IP and includes the extra term(s) without
// creating a second SPF record or dropping mechanisms already present. It returns the resulting
// record and whether it differs from `existing`. When `existing` is not an SPF record it builds a
// fresh one.
func mergeSPF(existing, targetIP, extra string) (string, bool) {
	existing = strings.TrimSpace(existing)
	if !isSPF(existing) {
		return buildSPF(targetIP, extra), true
	}
	var allTok string
	var body []string
	for _, tk := range strings.Fields(existing) {
		if strings.EqualFold(tk, "v=spf1") {
			continue
		}
		if isAllMech(tk) {
			allTok = tk
			continue
		}
		body = append(body, tk)
	}
	changed := false
	var want []string
	if strings.TrimSpace(targetIP) != "" {
		want = append(want, "ip4:"+strings.TrimSpace(targetIP))
	}
	want = append(want, spfTerms(extra)...)
	for _, w := range want {
		if !containsFold(body, w) {
			body = append(body, w)
			changed = true
		}
	}
	if allTok == "" {
		allTok = "~all"
		changed = true
	}
	rebuilt := append([]string{"v=spf1"}, body...)
	rebuilt = append(rebuilt, allTok)
	return strings.Join(rebuilt, " "), changed
}

// buildDMARC builds a DMARC record with the given policy (none|quarantine|reject, default none)
// and optional aggregate-report mailbox.
func buildDMARC(policy, rua string) string {
	switch strings.ToLower(strings.TrimSpace(policy)) {
	case "none", "quarantine", "reject":
		policy = strings.ToLower(strings.TrimSpace(policy))
	default:
		policy = "none"
	}
	out := "v=DMARC1; p=" + policy
	if r := strings.TrimSpace(rua); r != "" {
		out += "; rua=mailto:" + r
	}
	return out
}

// isDMARC reports whether a TXT content is a DMARC record.
func isDMARC(s string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(strings.Trim(s, `"`))), "v=dmarc1")
}

// txtContent strips surrounding quotes/whitespace from a TXT record's content as the API returns it.
func txtContent(s string) string { return strings.TrimSpace(strings.Trim(strings.TrimSpace(s), `"`)) }

func sameHost(a, b string) bool {
	return strings.EqualFold(strings.Trim(a, "."), strings.Trim(b, "."))
}

// ---------------------------------------------------------------------------
// SPF / DMARC DNS ensure (shared by the Cloudflare DNS step and the Email setup step)
// ---------------------------------------------------------------------------

type mailDNSOutcome struct {
	SPF     string // human line, e.g. "SPF example.com = v=spf1 ... (updated)"
	DMARC   string
	Changed bool
}

// ensureMailDNS ensures an SPF record at the zone apex authorizes the target server, and a DMARC
// record exists at _dmarc.<apex>. SPF is merged into any existing record (no second SPF created);
// DMARC is created only when absent (an operator's stricter policy is never downgraded). It logs
// every action and never returns an error (problems go to the log and leave the outcome lines empty).
func (e *Engine) ensureMailDNS(ctx context.Context, client *cloudflare.Client, zoneID, zoneName, targetIP string, smtp storage.SMTPSettings, logFn func(level, message string)) mailDNSOutcome {
	apex := strings.ToLower(strings.Trim(zoneName, "."))
	var oc mailDNSOutcome

	existing, err := client.ListAllDNSRecords(ctx, zoneID)
	if err != nil {
		logFn("warn", fmt.Sprintf("Email DNS %s: could not read records to ensure SPF/DMARC: %v", apex, err))
		return oc
	}

	// --- SPF at the apex ---
	currentSPF := ""
	for _, r := range existing {
		if strings.EqualFold(r.Type, "TXT") && sameHost(r.Name, apex) {
			if c := txtContent(r.Content); isSPF(c) {
				currentSPF = c
				break
			}
		}
	}
	desiredSPF, changed := mergeSPF(currentSPF, targetIP, smtp.SPFExtra)
	if desiredSPF != "" {
		if currentSPF != "" && !changed {
			oc.SPF = fmt.Sprintf("SPF %s already authorizes the target (%s)", apex, desiredSPF)
			logFn("info", "Email DNS: "+oc.SPF)
		} else {
			up, err := client.UpsertRecords(ctx, zoneID, existing, []cloudflare.DesiredRecord{{Type: "TXT", Name: apex, Content: desiredSPF, TTL: 3600}})
			if err != nil {
				logFn("error", fmt.Sprintf("Email DNS %s: could not set SPF: %v", apex, err))
			} else {
				verb := "unchanged"
				if len(up.Created) > 0 {
					verb = "created"
					oc.Changed = true
				} else if len(up.Updated) > 0 {
					verb = "updated"
					oc.Changed = true
				}
				oc.SPF = fmt.Sprintf("SPF %s = %s (%s)", apex, desiredSPF, verb)
				logFn("info", "Email DNS: "+oc.SPF)
			}
		}
	}

	// --- DMARC at _dmarc.<apex> ---
	dmarcName := "_dmarc." + apex
	currentDMARC := ""
	for _, r := range existing {
		if strings.EqualFold(r.Type, "TXT") && sameHost(r.Name, dmarcName) {
			if c := txtContent(r.Content); isDMARC(c) {
				currentDMARC = c
				break
			}
		}
	}
	if currentDMARC != "" {
		oc.DMARC = fmt.Sprintf("DMARC %s already present (%s); left unchanged", dmarcName, currentDMARC)
		logFn("info", "Email DNS: "+oc.DMARC)
	} else {
		desiredDMARC := buildDMARC(smtp.DMARCPolicy, smtp.DMARCRua)
		up, err := client.UpsertRecords(ctx, zoneID, existing, []cloudflare.DesiredRecord{{Type: "TXT", Name: dmarcName, Content: desiredDMARC, TTL: 3600}})
		if err != nil {
			logFn("error", fmt.Sprintf("Email DNS %s: could not create DMARC: %v", dmarcName, err))
		} else if len(up.Created) > 0 {
			oc.Changed = true
			oc.DMARC = fmt.Sprintf("DMARC %s = %s (created)", dmarcName, desiredDMARC)
			logFn("info", "Email DNS: "+oc.DMARC)
		}
	}
	return oc
}

// ---------------------------------------------------------------------------
// Email setup post-migration step
// ---------------------------------------------------------------------------

// EmailSetup is a post-migration step for completed migrations: it configures FluentSMTP on every
// migrated WordPress site so outbound mail goes through the central SMTP host, and ensures SPF +
// DMARC in Cloudflare DNS for the migrated domain(s). It never creates or touches DKIM. Requires
// central SMTP settings to be configured; SPF/DMARC need a Cloudflare token. Every action is logged.
func (e *Engine) EmailSetup(ctx context.Context, migrationID string) (*MigrationResult, *EmailSetupResult, error) {
	m, err := e.db.GetMigration(ctx, migrationID)
	if err != nil {
		return nil, nil, fmt.Errorf("migration not found: %w", err)
	}
	if m.Status != "completed" {
		return nil, nil, fmt.Errorf("only completed migrations can run email setup (status: %s)", m.Status)
	}
	targetServer, err := e.db.GetServer(ctx, m.TargetServerID)
	if err != nil {
		return nil, nil, fmt.Errorf("target server not found: %w", err)
	}
	if common.PanelType(targetServer.PanelType) != common.PanelTypeEnhance {
		return nil, nil, fmt.Errorf("email setup is only implemented for Enhance targets")
	}

	smtp, err := e.db.GetSMTPSettings(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("could not read SMTP settings: %w", err)
	}
	if strings.TrimSpace(smtp.Host) == "" {
		return nil, nil, fmt.Errorf("central SMTP settings are not configured; set them in Settings before running email setup")
	}
	password, _ := e.db.GetSMTPPassword(ctx)

	var export common.ExportData
	if m.ExportData.Valid && len(m.ExportData.Data) > 0 {
		_ = json.Unmarshal(m.ExportData.Data, &export)
	}
	domains := export.Domains
	if len(domains) == 0 && export.Account.Domain != "" {
		domains = []common.Domain{{Name: export.Account.Domain}}
	}
	if len(domains) == 0 {
		return nil, nil, fmt.Errorf("no domains are recorded for this migration")
	}

	logFn := func(level, message string) { e.db.AddMigrationLog(ctx, migrationID, level, message, nil) }
	out := &EmailSetupResult{}

	var names []string
	for _, d := range domains {
		if d.TargetDomain != "" {
			names = append(names, d.TargetDomain)
		} else {
			names = append(names, d.Name)
		}
	}
	out.Domains = names
	logFn("info", fmt.Sprintf("Email setup started (operator action): sites %s, SMTP host %s:%s", strings.Join(names, ", "), smtp.Host, smtp.Port))

	// 1. FluentSMTP on each migrated site (learn the cluster node from the first website).
	probe := enhance.New()
	probe.SetLogger(logFn)
	if err := probe.ConnectAPI(ctx, e.db.ToConnectionConfig(targetServer), func() string { k, _ := e.db.GetServerAPIKey(ctx, targetServer.ID); return k }()); err != nil {
		logFn("error", "Email setup failed: "+err.Error())
		return nil, nil, err
	}
	site, err := probe.FindWebsite(ctx, names[0])
	if err != nil {
		logFn("error", "Email setup failed: "+err.Error())
		return nil, nil, err
	}
	en, err := e.connectEnhanceTarget(ctx, migrationID, targetServer, site.AppServerID, logFn)
	if err != nil {
		logFn("error", "Email setup failed: "+err.Error())
		return nil, nil, err
	}
	defer en.Disconnect()

	cfg := enhance.FluentSMTPConfig{
		Host:       smtp.Host,
		Port:       smtp.Port,
		Encryption: smtp.Encryption,
		AuthUser:   smtp.AuthUser,
		Password:   password,
		FromName:   smtp.FromName,
		FromEmail:  smtp.FromEmail,
	}
	fsummary, err := en.ConfigureFluentSMTP(ctx, domains, cfg)
	if err != nil {
		logFn("error", "Email setup (FluentSMTP) failed: "+err.Error())
		return nil, nil, err
	}
	out.FluentSMTP = fsummary
	if n := len(en.Warnings()); n > 0 {
		logFn("warn", fmt.Sprintf("FluentSMTP finished with %d warning(s); see the lines above", n))
	}

	// 2. SPF + DMARC in DNS (no DKIM). Needs a Cloudflare token and a known target IP.
	targetIP := m.TargetIP.String
	if targetIP == "" {
		targetIP, _ = e.db.GetCloudflareTargetIP(ctx)
	}
	token, _ := e.db.GetCloudflareToken(ctx)
	switch {
	case token == "":
		out.DNSSkipped = "no Cloudflare API token is configured; set SPF/DMARC by hand"
		logFn("warn", "Email setup: "+out.DNSSkipped)
	case targetIP == "":
		out.DNSSkipped = "the target server IP is unknown; cannot build the SPF record"
		logFn("warn", "Email setup: "+out.DNSSkipped)
	default:
		status, _ := e.GetMigrationStatus(ctx, migrationID)
		mailDomains := e.migrationDomains(status, m.TargetDomain.String)
		client := cloudflare.New(token)
		client.SetLogger(logFn)
		doneZones := map[string]bool{}
		for _, domain := range mailDomains {
			zone, err := client.FindZoneForDomain(ctx, domain)
			if err != nil {
				logFn("error", fmt.Sprintf("Email DNS: could not look up a zone for %s: %v", domain, err))
				continue
			}
			if zone == nil {
				logFn("info", fmt.Sprintf("Email DNS: %s is not in our Cloudflare account; set SPF/DMARC wherever its DNS is hosted", domain))
				continue
			}
			if doneZones[zone.ID] {
				continue
			}
			doneZones[zone.ID] = true
			oc := e.ensureMailDNS(ctx, client, zone.ID, zone.Name, targetIP, smtp, logFn)
			if oc.SPF != "" {
				out.SPFEnsured = append(out.SPFEnsured, oc.SPF)
			}
			if oc.DMARC != "" {
				out.DMARCEnsured = append(out.DMARCEnsured, oc.DMARC)
			}
		}
	}

	logFn("info", fmt.Sprintf("Email setup finished: %d site(s) configured, %d SPF and %d DMARC record(s) ensured", len(out.FluentSMTP), len(out.SPFEnsured), len(out.DMARCEnsured)))
	status, err := e.GetMigrationStatus(ctx, migrationID)
	return status, out, err
}

// maybeAutoEmailSetup runs EmailSetup automatically at the end of a migration when central SMTP
// settings are configured. It never fails the migration: problems only go to the log.
func (e *Engine) maybeAutoEmailSetup(ctx context.Context, migrationID string) {
	has, err := e.db.HasSMTPConfigured(ctx)
	if err != nil || !has {
		return
	}
	e.db.AddMigrationLog(ctx, migrationID, "info", "Central SMTP settings are configured; setting up outbound email automatically", nil)
	if _, _, err := e.EmailSetup(ctx, migrationID); err != nil {
		e.db.AddMigrationLog(ctx, migrationID, "warn", fmt.Sprintf("Automatic email setup did not run: %v. You can trigger it from the migration page.", err), nil)
	}
}
