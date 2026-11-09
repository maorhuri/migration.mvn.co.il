package migration

import (
	"context"
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/migration-tool/backend/internal/cloudflare"
	"github.com/migration-tool/backend/internal/panels/common"
)

// CloudflareZoneResult is what happened for one domain's zone during an Update Cloudflare DNS run.
type CloudflareZoneResult struct {
	Domain      string   `json:"domain"`
	Zone        string   `json:"zone,omitempty"`
	ZoneID      string   `json:"zone_id,omitempty"`
	Found       bool     `json:"found"`
	FullZone    bool     `json:"full_zone"`              // true when the full exported zone was replicated (vs the @/www fallback)
	Created     []string `json:"created,omitempty"`      // records created, human lines
	Updated     []string `json:"updated,omitempty"`      // records changed, human lines
	Deleted     []string `json:"deleted,omitempty"`      // AAAA records removed (no IPv6 target)
	SkippedMail []string `json:"skipped_mail,omitempty"` // mail records left untouched because mail is external
	Unchanged   int      `json:"unchanged"`              // records already correct
	Verified    []string `json:"verified,omitempty"`     // re-read result per web record
	Purged      bool     `json:"purged"`
	Skipped     string   `json:"skipped,omitempty"` // reason when the zone was not acted on
	SPF         string   `json:"spf,omitempty"`     // SPF record ensured for outbound mail (email setup)
	DMARC       string   `json:"dmarc,omitempty"`   // DMARC record ensured for outbound mail (email setup)
}

// CloudflareDNSResult summarizes an Update Cloudflare DNS run across all of a migration's domains.
type CloudflareDNSResult struct {
	TargetIP       string                 `json:"target_ip"`
	TargetIPv6     string                 `json:"target_ipv6,omitempty"`
	OldIP          string                 `json:"old_ip,omitempty"`
	Zones          []CloudflareZoneResult `json:"zones"`
	RecordsCreated int                    `json:"records_created"`
	RecordsUpdated int                    `json:"records_updated"`
	RecordsDeleted int                    `json:"records_deleted"`
	Unchanged      int                    `json:"unchanged"`
	MailSkipped    int                    `json:"mail_skipped"`
	// RecordsChanged = created + updated + deleted (kept for the frontend summary).
	RecordsChanged int `json:"records_changed"`
	ZonesUpdated   int `json:"zones_updated"`
}

// migrationDomains returns the distinct, normalized customer-facing domains of a completed
// migration: every exported domain (its chosen target domain when set, else its name) plus the
// operator's TargetDomain and the account domain. Internal hosting hostnames are kept out when a
// real target domain exists for that entry.
func (e *Engine) migrationDomains(m *MigrationResult, targetDomain string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(d string) {
		d = normalizeDomain(d)
		if d == "" || !strings.Contains(d, ".") || seen[d] {
			return
		}
		seen[d] = true
		out = append(out, d)
	}
	if m.ExportData != nil {
		for _, d := range m.ExportData.Domains {
			if d.TargetDomain != "" {
				add(d.TargetDomain)
			} else {
				add(d.Name)
			}
			for _, a := range d.Aliases {
				add(a)
			}
		}
		add(m.ExportData.Account.Domain)
	}
	add(targetDomain)
	return out
}

// resolveOldSourceIP best-effort determines the OLD source server's IPv4, so A records still
// pointing at it (beyond @ and www) can be repointed too. Returns "" when it cannot be determined.
func resolveOldSourceIP(host string) string {
	host = strings.TrimSpace(host)
	if host == "" {
		return ""
	}
	if ip := net.ParseIP(host); ip != nil {
		if v4 := ip.To4(); v4 != nil {
			return v4.String()
		}
		return "" // an IPv6 literal: not an IPv4 source to match A records against
	}
	addrs, err := net.LookupHost(host)
	if err != nil {
		return ""
	}
	for _, a := range addrs {
		if ip := net.ParseIP(a); ip != nil && ip.To4() != nil {
			return ip.To4().String()
		}
	}
	return ""
}

// UpdateCloudflareDNS repoints the DNS of a completed migration's domain(s) at the new server in
// Cloudflare: for every domain whose zone is in OUR account it finds the zone, updates the A
// (and AAAA) records (root @, www, and any A still pointing at the old source IP) to the new
// target IP in one batch, purges the zone cache and verifies by re-reading the records. Domains
// whose zone is not in our account are skipped with a clear log line. Every action is logged into
// the migration log. It is a post-migration step, only allowed for completed migrations.
func (e *Engine) UpdateCloudflareDNS(ctx context.Context, migrationID string) (*MigrationResult, *CloudflareDNSResult, error) {
	m, err := e.db.GetMigration(ctx, migrationID)
	if err != nil {
		return nil, nil, fmt.Errorf("migration not found: %w", err)
	}
	if m.Status != "completed" {
		return nil, nil, fmt.Errorf("only completed migrations can update Cloudflare DNS (status: %s)", m.Status)
	}

	token, err := e.db.GetCloudflareToken(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("could not read the Cloudflare token: %w", err)
	}
	if token == "" {
		return nil, nil, fmt.Errorf("no Cloudflare API token is configured; set it in Settings before updating DNS")
	}

	logFn := func(level, message string) { e.db.AddMigrationLog(ctx, migrationID, level, message, nil) }

	// Target IP: prefer the node IP the import recorded; fall back to the configured one.
	targetIP := m.TargetIP.String
	if targetIP == "" {
		targetIP, _ = e.db.GetCloudflareTargetIP(ctx)
	}
	if targetIP == "" {
		logFn("error", "Update Cloudflare DNS: the new server IP is unknown (the migration recorded no target IP and no fallback is set in Settings)")
		return nil, nil, fmt.Errorf("the new server IP is unknown: set a fallback target IP in Cloudflare settings")
	}
	targetIPv6, _ := e.db.GetCloudflareTargetIPv6(ctx)

	// When central email is configured, the DNS run also ensures SPF/DMARC for outbound mail.
	smtp, _ := e.db.GetSMTPSettings(ctx)

	result, err := e.GetMigrationStatus(ctx, migrationID)
	if err != nil {
		return nil, nil, err
	}

	domains := e.migrationDomains(result, m.TargetDomain.String)
	if len(domains) == 0 {
		logFn("warn", "Update Cloudflare DNS: this migration has no customer-facing domains to repoint")
		return result, &CloudflareDNSResult{TargetIP: targetIP, TargetIPv6: targetIPv6}, nil
	}

	oldIP := ""
	if src, err := e.db.GetServer(ctx, m.SourceServerID); err == nil {
		oldIP = resolveOldSourceIP(src.Host)
	}

	client := cloudflare.New(token)
	client.SetLogger(logFn)

	out := &CloudflareDNSResult{TargetIP: targetIP, TargetIPv6: targetIPv6, OldIP: oldIP}
	logFn("info", fmt.Sprintf("Update Cloudflare DNS: repointing %d domain(s) to %s%s", len(domains), targetIP, oldIPNote(oldIP)))

	// A zone can back several of the migration's domains (apex + addon); act on each zone once.
	doneZones := map[string]bool{}
	for _, domain := range domains {
		zr := CloudflareZoneResult{Domain: domain}
		zone, err := client.FindZoneForDomain(ctx, domain)
		if err != nil {
			zr.Skipped = fmt.Sprintf("lookup failed: %v", err)
			logFn("error", fmt.Sprintf("Cloudflare: could not look up a zone for %s: %v", domain, err))
			out.Zones = append(out.Zones, zr)
			continue
		}
		if zone == nil {
			zr.Skipped = "zone not in our Cloudflare account"
			logFn("info", fmt.Sprintf("Cloudflare: %s is not in our Cloudflare account; skipping (repoint its DNS wherever it is hosted)", domain))
			out.Zones = append(out.Zones, zr)
			continue
		}
		zr.Found = true
		zr.Zone = zone.Name
		zr.ZoneID = zone.ID
		if doneZones[zone.ID] {
			zr.Skipped = fmt.Sprintf("zone %s already updated for another domain", zone.Name)
			out.Zones = append(out.Zones, zr)
			continue
		}
		doneZones[zone.ID] = true

		e.applyZoneDNS(ctx, client, &zr, out, zone, domain, result, targetIP, targetIPv6, oldIP, logFn)

		// Outbound-mail DNS (SPF + DMARC, never DKIM): only when central email is configured.
		if strings.TrimSpace(smtp.Host) != "" {
			oc := e.ensureMailDNS(ctx, client, zone.ID, zone.Name, targetIP, smtp, logFn)
			zr.SPF = oc.SPF
			zr.DMARC = oc.DMARC
		}
		out.Zones = append(out.Zones, zr)
	}

	out.RecordsChanged = out.RecordsCreated + out.RecordsUpdated + out.RecordsDeleted
	if out.ZonesUpdated > 0 || out.RecordsChanged > 0 {
		if err := e.db.SetMigrationCloudflareDNSUpdated(ctx, migrationID, true); err != nil {
			logFn("warn", fmt.Sprintf("Cloudflare DNS updated but the migration record could not be marked: %v", err))
		}
	}
	logFn("info", fmt.Sprintf("Update Cloudflare DNS finished: %d zone(s) touched, %d created, %d updated, %d deleted, %d unchanged, %d external-mail record(s) skipped", out.ZonesUpdated, out.RecordsCreated, out.RecordsUpdated, out.RecordsDeleted, out.Unchanged, out.MailSkipped))

	status, err := e.GetMigrationStatus(ctx, migrationID)
	if err != nil {
		return nil, out, err
	}
	return status, out, nil
}

// maybeAutoUpdateCloudflareDNS runs UpdateCloudflareDNS automatically at the end of a migration
// when a token is configured. It never fails the migration: problems only go to the log.
func (e *Engine) maybeAutoUpdateCloudflareDNS(ctx context.Context, migrationID string) {
	has, err := e.db.HasCloudflareToken(ctx)
	if err != nil || !has {
		return
	}
	e.db.AddMigrationLog(ctx, migrationID, "info", "A Cloudflare token is configured; updating DNS automatically", nil)
	if _, _, err := e.UpdateCloudflareDNS(ctx, migrationID); err != nil {
		e.db.AddMigrationLog(ctx, migrationID, "warn", fmt.Sprintf("Automatic Cloudflare DNS update did not run: %v. You can trigger it from the migration page.", err), nil)
	}
}

// recordNames returns the fully-qualified record names to repoint for a migrated domain within a
// zone: the zone apex and www.<apex> (the "root @ and www" minimum) plus the domain itself and
// www.<domain> when the migrated domain is a subdomain of the zone.
func recordNames(zoneName, domain string) []string {
	zoneName = strings.ToLower(strings.Trim(zoneName, "."))
	domain = strings.ToLower(strings.Trim(domain, "."))
	seen := map[string]bool{}
	var names []string
	add := func(n string) {
		n = strings.ToLower(strings.Trim(n, "."))
		if n == "" || seen[n] {
			return
		}
		seen[n] = true
		names = append(names, n)
	}
	add(zoneName)
	add("www." + zoneName)
	if domain != "" && domain != zoneName {
		add(domain)
		add("www." + domain)
	}
	return names
}

func oldIPNote(oldIP string) string {
	if oldIP == "" {
		return ""
	}
	return fmt.Sprintf(" (also any A record still pointing at the old source %s)", oldIP)
}

// applyZoneDNS performs the DNS changes for one zone, then purges and verifies. When the
// migration exported a DNS zone for this domain it replicates the FULL zone (A/AAAA/CNAME/MX/
// TXT/SRV/CAA) with smart repointing, SPF rewriting and external-mail safety; otherwise it falls
// back to repointing @/www A (and AAAA) to the target IP. It fills zr and the shared out counters.
func (e *Engine) applyZoneDNS(ctx context.Context, client *cloudflare.Client, zr *CloudflareZoneResult, out *CloudflareDNSResult, zone *cloudflare.Zone, domain string, result *MigrationResult, targetIP, targetIPv6, oldIP string, logFn func(level, message string)) {
	names := recordNames(zone.Name, domain)
	exported, origin := exportedDNSForZone(result, zone.Name)
	changed := false

	if len(exported) > 0 {
		zr.FullZone = true
		existing, err := client.ListAllDNSRecords(ctx, zone.ID)
		if err != nil {
			zr.Skipped = fmt.Sprintf("could not read records: %v", err)
			logFn("error", fmt.Sprintf("Cloudflare zone %s: could not read DNS records: %v", zone.Name, err))
			return
		}
		ownDomains := e.ownDomainSet(result, zone.Name, origin)
		desired, skippedMail, aaaaDelete := e.buildDesiredRecords(zone.Name, origin, ownDomains, existing, exported, targetIP, targetIPv6, oldIP, names, logFn)
		for _, s := range skippedMail {
			zr.SkippedMail = append(zr.SkippedMail, s)
			logFn("info", "Cloudflare: "+s)
		}
		out.MailSkipped += len(skippedMail)

		upres, err := client.UpsertRecords(ctx, zone.ID, existing, desired)
		if err != nil {
			zr.Skipped = fmt.Sprintf("upsert failed: %v", err)
			logFn("error", fmt.Sprintf("Cloudflare zone %s: replicating the zone failed: %v", zone.Name, err))
			return
		}
		for _, r := range upres.Created {
			line := recordLine(r)
			zr.Created = append(zr.Created, line)
			logFn("info", "Cloudflare: created "+line)
		}
		for _, r := range upres.Updated {
			line := recordLine(r)
			zr.Updated = append(zr.Updated, line)
			logFn("info", "Cloudflare: updated "+line)
		}
		zr.Unchanged = len(upres.Unchanged)
		out.RecordsCreated += len(upres.Created)
		out.RecordsUpdated += len(upres.Updated)
		out.Unchanged += len(upres.Unchanged)

		if err := client.DeleteRecords(ctx, zone.ID, aaaaDelete); err != nil {
			logFn("warn", fmt.Sprintf("Cloudflare zone %s: could not remove stale AAAA record(s): %v", zone.Name, err))
		} else if len(aaaaDelete) > 0 {
			for _, ex := range existing {
				if containsStr(aaaaDelete, ex.ID) {
					line := fmt.Sprintf("AAAA %s (was %s)", ex.Name, ex.Content)
					zr.Deleted = append(zr.Deleted, line)
					logFn("info", fmt.Sprintf("Cloudflare: removed %s so %s resolves to the new IPv4 (no IPv6 target configured)", line, ex.Name))
				}
			}
			out.RecordsDeleted += len(aaaaDelete)
		}
		changed = len(upres.Created)+len(upres.Updated)+len(aaaaDelete) > 0
		if !changed {
			logFn("info", fmt.Sprintf("Cloudflare zone %s: already matches the source zone; nothing to change", zone.Name))
		}
	} else {
		// Fallback: no exported zone -> repoint @/www A (and AAAA) to the target IP.
		existing, err := client.ListDNSRecords(ctx, zone.ID)
		if err != nil {
			zr.Skipped = fmt.Sprintf("could not read records: %v", err)
			logFn("error", fmt.Sprintf("Cloudflare zone %s: could not read DNS records: %v", zone.Name, err))
			return
		}
		logFn("info", fmt.Sprintf("Cloudflare zone %s: no exported DNS zone for this domain; repointing @/www only", zone.Name))
		upd, err := client.UpdateARecords(ctx, zone.ID, existing, targetIP, targetIPv6, oldIP, names)
		if err != nil {
			zr.Skipped = fmt.Sprintf("update failed: %v", err)
			logFn("error", fmt.Sprintf("Cloudflare zone %s: updating records failed: %v", zone.Name, err))
			return
		}
		for _, r := range upd.Patched {
			line := fmt.Sprintf("%s %s -> %s", r.Type, r.Name, r.Content)
			zr.Updated = append(zr.Updated, line)
			logFn("info", "Cloudflare: updated "+line)
		}
		for _, r := range upd.Deleted {
			line := fmt.Sprintf("%s %s (was %s)", r.Type, r.Name, r.Content)
			zr.Deleted = append(zr.Deleted, line)
			logFn("info", fmt.Sprintf("Cloudflare: removed %s so %s resolves to the new IPv4 (no IPv6 target configured)", line, r.Name))
		}
		out.RecordsUpdated += len(upd.Patched)
		out.RecordsDeleted += len(upd.Deleted)
		changed = len(upd.Patched)+len(upd.Deleted) > 0
		if !changed {
			logFn("info", fmt.Sprintf("Cloudflare zone %s: records already point at %s; nothing to change", zone.Name, targetIP))
		}
	}

	if changed {
		out.ZonesUpdated++
	}

	// Purge cache (the origin content changed even when the records already matched).
	if err := client.PurgeCache(ctx, zone.ID); err != nil {
		logFn("warn", fmt.Sprintf("Cloudflare zone %s: cache purge failed: %v", zone.Name, err))
	} else {
		zr.Purged = true
		logFn("info", fmt.Sprintf("Cloudflare zone %s: purged cache (purge_everything)", zone.Name))
	}

	// Verify the web records by re-reading them.
	verified, err := client.Verify(ctx, zone.ID, targetIP, targetIPv6, names)
	if err != nil {
		logFn("warn", fmt.Sprintf("Cloudflare zone %s: could not verify records: %v", zone.Name, err))
	} else {
		for _, v := range verified {
			status := "OK"
			if !v.OK {
				status = "unexpected"
			}
			line := fmt.Sprintf("%s %s = %s (%s)", v.Type, v.Name, v.Content, status)
			zr.Verified = append(zr.Verified, line)
			lvl := "info"
			if !v.OK && v.Type == "A" {
				lvl = "warn"
			}
			logFn(lvl, "Cloudflare verify: "+line)
		}
	}
}

// exportedDNSForZone returns the migration's exported DNS records when they belong to this zone,
// plus the origin domain they were parsed under. The export carries one zone (the account's main
// domain, from /var/named/<domain>.db); it is used only for the zone that covers that domain.
func exportedDNSForZone(result *MigrationResult, zoneName string) ([]common.DNSRecord, string) {
	if result == nil || result.ExportData == nil || len(result.ExportData.DNSRecords) == 0 {
		return nil, ""
	}
	origin := normalizeDomain(result.ExportData.Account.Domain)
	if origin == "" && len(result.ExportData.Domains) > 0 {
		d := result.ExportData.Domains[0]
		if d.TargetDomain != "" {
			origin = normalizeDomain(d.TargetDomain)
		} else {
			origin = normalizeDomain(d.Name)
		}
	}
	zoneName = strings.ToLower(strings.Trim(zoneName, "."))
	// The exported zone applies to the zone that covers the origin domain.
	if origin == zoneName || strings.HasSuffix(origin, "."+zoneName) || zoneName == "" {
		return result.ExportData.DNSRecords, origin
	}
	return nil, origin
}

// ownDomainSet is the set of the account's own domains (normalized, no trailing dot): used to tell
// whether an MX host points at the migrated server's own domains (internal mail) vs an external
// provider.
func (e *Engine) ownDomainSet(result *MigrationResult, zoneName, origin string) map[string]bool {
	set := map[string]bool{}
	add := func(d string) {
		d = normalizeDomain(d)
		if d != "" {
			set[d] = true
		}
	}
	add(zoneName)
	add(origin)
	if result != nil && result.ExportData != nil {
		add(result.ExportData.Account.Domain)
		for _, d := range result.ExportData.Domains {
			add(d.Name)
			add(d.TargetDomain)
			for _, a := range d.Aliases {
				add(a)
			}
		}
	}
	return set
}

// buildDesiredRecords transforms the exported zone into the records to upsert into Cloudflare,
// applying: web repointing (@/www and any A/AAAA at the old source IP -> target IP), SPF ip4
// rewrite (old -> new), external-mail safety (MX and autodiscover/autoconfig left untouched when
// mail is off-server), and skipping NS/SOA/PTR. It also returns the ids of existing AAAA records
// on @/www to delete when no IPv6 target is configured. skippedMail holds one line per skipped
// mail record.
func (e *Engine) buildDesiredRecords(zoneName, origin string, ownDomains map[string]bool, existing []cloudflare.DNSRecord, exported []common.DNSRecord, targetIP, targetIPv6, oldIP string, names []string, logFn func(level, message string)) (desired []cloudflare.DesiredRecord, skippedMail []string, aaaaDelete []string) {
	nameInSet := func(n string) bool {
		for _, x := range names {
			if strings.EqualFold(strings.Trim(n, "."), strings.Trim(x, ".")) {
				return true
			}
		}
		return false
	}

	// Decide once whether the domain's mail is external: any MX host that is not on the migrated
	// server (not one of the account's own domains and not resolving to the old/new server IP).
	mailExternal := false
	for _, r := range exported {
		if strings.EqualFold(r.Type, "MX") {
			_, host := mxParts(r)
			if host != "" && e.mxIsExternal(host, ownDomains, oldIP, targetIP) {
				mailExternal = true
			}
		}
	}

	for _, r := range exported {
		typ := strings.ToUpper(strings.TrimSpace(r.Type))
		switch typ {
		case "NS", "SOA", "PTR":
			continue // Cloudflare manages NS/SOA; PTR is reverse DNS, not applicable here
		}
		name := zoneRecordName(r.Name, zoneName, origin)
		ttl := r.TTL
		if ttl <= 0 {
			ttl = 3600
		}

		switch typ {
		case "A":
			ip := trimDot(firstField(r.Value))
			if ip == "" {
				continue
			}
			if nameInSet(name) || (oldIP != "" && ip == oldIP) {
				ip = targetIP
			}
			desired = append(desired, cloudflare.DesiredRecord{Type: "A", Name: name, Content: ip, TTL: ttl})
		case "AAAA":
			if targetIPv6 == "" {
				continue // cannot point AAAA at an IPv4 target; stale @/www AAAA handled via aaaaDelete
			}
			ip := trimDot(firstField(r.Value))
			if ip == "" {
				continue
			}
			if nameInSet(name) {
				ip = targetIPv6
			}
			desired = append(desired, cloudflare.DesiredRecord{Type: "AAAA", Name: name, Content: ip, TTL: ttl})
		case "CNAME":
			target := trimDot(firstField(r.Value))
			if target == "" {
				continue
			}
			if mailExternal && isMailDiscovery(name) {
				skippedMail = append(skippedMail, fmt.Sprintf("skipping external mail: CNAME %s -> %s (autodiscover/autoconfig, mail is off-server)", name, target))
				continue
			}
			desired = append(desired, cloudflare.DesiredRecord{Type: "CNAME", Name: name, Content: target, TTL: ttl})
		case "MX":
			prio, host := mxParts(r)
			if host == "" {
				continue
			}
			if mailExternal {
				skippedMail = append(skippedMail, fmt.Sprintf("skipping external mail: MX %d -> %s (not on the migrated server)", prio, host))
				continue
			}
			desired = append(desired, cloudflare.DesiredRecord{Type: "MX", Name: name, Content: host, TTL: ttl, Priority: prio})
		case "TXT":
			content := unquoteTXT(r.Value)
			if content == "" {
				continue
			}
			if isSPF(content) && oldIP != "" && strings.Contains(content, oldIP) {
				rewritten := strings.ReplaceAll(content, oldIP, targetIP)
				logFn("info", fmt.Sprintf("Cloudflare: rewriting SPF ip4 %s -> %s on %s", oldIP, targetIP, name))
				content = rewritten
			}
			desired = append(desired, cloudflare.DesiredRecord{Type: "TXT", Name: name, Content: content, TTL: ttl})
		case "SRV":
			content := strings.TrimSpace(r.Value)
			if content == "" {
				continue
			}
			if mailExternal && isMailDiscovery(name) {
				skippedMail = append(skippedMail, fmt.Sprintf("skipping external mail: SRV %s -> %s (autodiscover/autoconfig, mail is off-server)", name, content))
				continue
			}
			desired = append(desired, cloudflare.DesiredRecord{Type: "SRV", Name: name, Content: content, TTL: ttl})
		case "CAA":
			content := strings.TrimSpace(r.Value)
			if content == "" {
				continue
			}
			desired = append(desired, cloudflare.DesiredRecord{Type: "CAA", Name: name, Content: content, TTL: ttl})
		default:
			content := strings.TrimSpace(r.Value)
			if content != "" {
				desired = append(desired, cloudflare.DesiredRecord{Type: typ, Name: name, Content: content, TTL: ttl})
			}
		}
	}

	if targetIPv6 == "" {
		for _, ex := range existing {
			if strings.EqualFold(ex.Type, "AAAA") && nameInSet(ex.Name) {
				aaaaDelete = append(aaaaDelete, ex.ID)
			}
		}
	}
	return desired, skippedMail, aaaaDelete
}

// mxIsExternal reports whether an MX host is NOT on the migrated server: its host is not one of
// the account's own domains and does not resolve to the old or new server IP. A host that cannot
// be resolved is treated as external (safer: we do not recreate its MX).
func (e *Engine) mxIsExternal(host string, ownDomains map[string]bool, oldIP, targetIP string) bool {
	h := strings.ToLower(strings.Trim(host, "."))
	if h == "" {
		return false
	}
	for d := range ownDomains {
		if h == d || strings.HasSuffix(h, "."+d) {
			return false
		}
	}
	addrs, err := net.LookupHost(h)
	if err == nil {
		for _, a := range addrs {
			if a == oldIP || a == targetIP {
				return false
			}
		}
	}
	return true
}

// zoneRecordName turns a zone-file owner name into a fully-qualified Cloudflare record name under
// zoneName. It handles "@"/empty (apex), relative labels, FQDNs already under the zone, and FQDNs
// under the source origin domain (rebased onto the zone when the target domain differs).
func zoneRecordName(raw, zoneName, origin string) string {
	raw = strings.ToLower(strings.Trim(strings.TrimSpace(raw), "."))
	zoneName = strings.ToLower(strings.Trim(zoneName, "."))
	origin = strings.ToLower(strings.Trim(origin, "."))
	if raw == "" || raw == "@" || raw == zoneName {
		return zoneName
	}
	if strings.HasSuffix(raw, "."+zoneName) {
		return raw
	}
	if origin != "" {
		if raw == origin {
			return zoneName
		}
		if strings.HasSuffix(raw, "."+origin) {
			return strings.TrimSuffix(raw, "."+origin) + "." + zoneName
		}
	}
	if strings.Contains(raw, ".") {
		return raw // some other FQDN; leave it as-is
	}
	return raw + "." + zoneName
}

// mxParts returns the priority and host of an exported MX record, whether the parser split them
// (Priority set, Value = host) or left them together in Value ("10 mail.example.com.").
func mxParts(r common.DNSRecord) (int, string) {
	if r.Priority > 0 && r.Value != "" {
		return r.Priority, trimDot(firstField(r.Value))
	}
	fields := strings.Fields(strings.TrimSpace(r.Value))
	if len(fields) >= 2 {
		if p, err := strconv.Atoi(fields[0]); err == nil {
			return p, trimDot(fields[1])
		}
	}
	if len(fields) == 1 {
		return r.Priority, trimDot(fields[0])
	}
	return r.Priority, ""
}

// isMailDiscovery reports whether a record name is a mail autodiscover/autoconfig name.
func isMailDiscovery(name string) bool {
	label := strings.ToLower(strings.Trim(name, "."))
	if i := strings.Index(label, "."); i >= 0 {
		label = label[:i]
	}
	label = strings.TrimPrefix(label, "_")
	return label == "autodiscover" || label == "autoconfig"
}

// isSPF reports whether a TXT content is an SPF record.
func isSPF(s string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(strings.Trim(s, `"`))), "v=spf1")
}

// unquoteTXT joins and unquotes a zone-file TXT value: `"a" "b"` -> `ab`, `"text"` -> `text`.
func unquoteTXT(s string) string {
	s = strings.TrimSpace(s)
	if !strings.Contains(s, `"`) {
		return s
	}
	var b strings.Builder
	inQuote := false
	for _, ch := range s {
		if ch == '"' {
			inQuote = !inQuote
			continue
		}
		if inQuote {
			b.WriteRune(ch)
		}
	}
	out := b.String()
	if out == "" {
		return strings.Trim(s, `"`)
	}
	return out
}

func firstField(s string) string {
	fields := strings.Fields(strings.TrimSpace(s))
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

func trimDot(s string) string { return strings.TrimSuffix(strings.TrimSpace(s), ".") }

func containsStr(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// recordLine renders a desired record for a log line.
func recordLine(r cloudflare.DesiredRecord) string {
	if strings.EqualFold(r.Type, "MX") {
		return fmt.Sprintf("MX %s -> %d %s", r.Name, r.Priority, r.Content)
	}
	return fmt.Sprintf("%s %s -> %s", strings.ToUpper(r.Type), r.Name, r.Content)
}
