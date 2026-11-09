package migration

import (
	"reflect"
	"testing"

	"github.com/migration-tool/backend/internal/panels/common"
)

func TestRecordNamesApexDomain(t *testing.T) {
	// Migrated domain is the zone apex itself: just @ and www.
	got := recordNames("example.com", "example.com")
	want := []string{"example.com", "www.example.com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("recordNames apex = %v, want %v", got, want)
	}
}

func TestRecordNamesSubdomain(t *testing.T) {
	// Migrated domain is a subdomain: apex, www.apex, the subdomain and its www.
	got := recordNames("example.com", "shop.example.com")
	want := []string{"example.com", "www.example.com", "shop.example.com", "www.shop.example.com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("recordNames subdomain = %v, want %v", got, want)
	}
}

func TestResolveOldSourceIP(t *testing.T) {
	if got := resolveOldSourceIP("203.0.113.9"); got != "203.0.113.9" {
		t.Fatalf("IPv4 literal: got %q", got)
	}
	if got := resolveOldSourceIP("2001:db8::1"); got != "" {
		t.Fatalf("IPv6 literal should yield no IPv4 match, got %q", got)
	}
	if got := resolveOldSourceIP(""); got != "" {
		t.Fatalf("empty host: got %q", got)
	}
}

func TestMigrationDomainsDedupAndTargetDomain(t *testing.T) {
	e := &Engine{}
	m := &MigrationResult{
		ExportData: &common.ExportData{
			Account: common.Account{Domain: "example.com"},
			Domains: []common.Domain{
				{Name: "internal.host.net", TargetDomain: "example.com", Aliases: []string{"www.example.com"}},
				{Name: "addon.org"},
			},
		},
	}
	got := e.migrationDomains(m, "example.com")
	// internal.host.net is superseded by its TargetDomain; www.example.com normalizes to example.com (deduped).
	want := []string{"example.com", "addon.org"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("migrationDomains = %v, want %v", got, want)
	}
}

func TestZoneRecordName(t *testing.T) {
	cases := []struct{ raw, zone, origin, want string }{
		{"@", "example.com", "example.com", "example.com"},
		{"www", "example.com", "example.com", "www.example.com"},
		{"www.example.com.", "example.com", "example.com", "www.example.com"},
		{"example.com", "example.com", "example.com", "example.com"},
		// Rebase a source-origin FQDN onto the (different) Cloudflare zone.
		{"www.internal.host.net.", "example.com", "internal.host.net", "www.example.com"},
	}
	for _, c := range cases {
		if got := zoneRecordName(c.raw, c.zone, c.origin); got != c.want {
			t.Fatalf("zoneRecordName(%q,%q,%q) = %q, want %q", c.raw, c.zone, c.origin, got, c.want)
		}
	}
}

func TestUnquoteTXTAndSPF(t *testing.T) {
	if got := unquoteTXT(`"v=spf1 ip4:1.2.3.4 ~all"`); got != "v=spf1 ip4:1.2.3.4 ~all" {
		t.Fatalf("unquoteTXT single = %q", got)
	}
	if got := unquoteTXT(`"part-a" "part-b"`); got != "part-apart-b" {
		t.Fatalf("unquoteTXT multi = %q", got)
	}
	if !isSPF(`"v=spf1 -all"`) || isSPF("v=DMARC1; p=none") {
		t.Fatalf("isSPF detection wrong")
	}
}

func TestMxParts(t *testing.T) {
	if p, h := mxParts(common.DNSRecord{Type: "MX", Priority: 10, Value: "mail.example.com."}); p != 10 || h != "mail.example.com" {
		t.Fatalf("split MX: got %d %q", p, h)
	}
	if p, h := mxParts(common.DNSRecord{Type: "MX", Value: "20 mx2.example.com."}); p != 20 || h != "mx2.example.com" {
		t.Fatalf("joined MX: got %d %q", p, h)
	}
}

func TestIsMailDiscovery(t *testing.T) {
	if !isMailDiscovery("autodiscover.example.com") || !isMailDiscovery("autoconfig.example.com") {
		t.Fatalf("should detect autodiscover/autoconfig")
	}
	if isMailDiscovery("www.example.com") {
		t.Fatalf("www should not be mail discovery")
	}
}

func TestMxIsExternal(t *testing.T) {
	e := &Engine{}
	own := map[string]bool{"example.com": true}
	if e.mxIsExternal("mail.example.com", own, "9.9.9.9", "1.2.3.4") {
		t.Fatalf("mail.example.com is on an own domain -> internal")
	}
	// A .invalid host never resolves, and is not an own domain -> treated as external (safe skip).
	if !e.mxIsExternal("mx.some-provider.invalid", own, "9.9.9.9", "1.2.3.4") {
		t.Fatalf("unresolvable non-own MX host should be external")
	}
}

func TestBuildDesiredRecordsInternalMailAndSPFRewrite(t *testing.T) {
	e := &Engine{}
	own := map[string]bool{"example.com": true}
	exported := []common.DNSRecord{
		{Type: "A", Name: "@", Value: "9.9.9.9", TTL: 3600},
		{Type: "A", Name: "www", Value: "9.9.9.9", TTL: 3600},
		{Type: "A", Name: "legacy", Value: "9.9.9.9", TTL: 3600}, // points at old IP -> repoint
		{Type: "A", Name: "static", Value: "5.5.5.5", TTL: 3600}, // unrelated -> carry
		{Type: "CNAME", Name: "ftp", Value: "example.com.", TTL: 3600},
		{Type: "MX", Name: "@", Priority: 10, Value: "mail.example.com.", TTL: 3600}, // internal
		{Type: "TXT", Name: "@", Value: `"v=spf1 ip4:9.9.9.9 ~all"`, TTL: 3600},      // SPF rewrite
		{Type: "TXT", Name: "_dmarc", Value: `"v=DMARC1; p=none"`, TTL: 3600},
		{Type: "NS", Name: "@", Value: "ns1.old.net.", TTL: 3600}, // skipped
	}
	names := []string{"example.com", "www.example.com"}
	desired, skippedMail, aaaaDelete := e.buildDesiredRecords("example.com", "example.com", own, nil, exported, "1.2.3.4", "", "9.9.9.9", names, func(string, string) {})

	if len(skippedMail) != 0 {
		t.Fatalf("mail is internal; expected no skips, got %v", skippedMail)
	}
	if len(aaaaDelete) != 0 {
		t.Fatalf("no existing AAAA; expected none to delete")
	}
	got := map[string]cloudflare_DesiredLite{}
	for _, d := range desired {
		got[d.Type+" "+d.Name] = cloudflare_DesiredLite{d.Content, d.Priority}
	}
	if got["NS @"].content != "" || got["NS example.com"].content != "" {
		t.Fatalf("NS must be skipped")
	}
	if got["A example.com"].content != "1.2.3.4" {
		t.Fatalf("apex A should repoint to target, got %q", got["A example.com"].content)
	}
	if got["A www.example.com"].content != "1.2.3.4" {
		t.Fatalf("www A should repoint, got %q", got["A www.example.com"].content)
	}
	if got["A legacy.example.com"].content != "1.2.3.4" {
		t.Fatalf("A at old IP should repoint, got %q", got["A legacy.example.com"].content)
	}
	if got["A static.example.com"].content != "5.5.5.5" {
		t.Fatalf("unrelated A should be carried as-is, got %q", got["A static.example.com"].content)
	}
	if got["MX example.com"].content != "mail.example.com" || got["MX example.com"].prio != 10 {
		t.Fatalf("internal MX should be carried, got %+v", got["MX example.com"])
	}
	if got["TXT example.com"].content != "v=spf1 ip4:1.2.3.4 ~all" {
		t.Fatalf("SPF ip4 should be rewritten to target, got %q", got["TXT example.com"].content)
	}
	if got["CNAME ftp.example.com"].content != "example.com" {
		t.Fatalf("CNAME should be carried (trimmed), got %q", got["CNAME ftp.example.com"].content)
	}
}

func TestBuildDesiredRecordsExternalMailSkips(t *testing.T) {
	e := &Engine{}
	own := map[string]bool{"example.com": true}
	exported := []common.DNSRecord{
		{Type: "A", Name: "@", Value: "9.9.9.9", TTL: 3600},
		{Type: "MX", Name: "@", Priority: 10, Value: "mx.some-provider.invalid.", TTL: 3600}, // external
		{Type: "CNAME", Name: "autodiscover", Value: "autodiscover.outlook.com.", TTL: 3600}, // mail discovery
	}
	names := []string{"example.com", "www.example.com"}
	desired, skippedMail, _ := e.buildDesiredRecords("example.com", "example.com", own, nil, exported, "1.2.3.4", "", "9.9.9.9", names, func(string, string) {})

	if len(skippedMail) != 2 {
		t.Fatalf("expected 2 skipped mail records (MX + autodiscover), got %d: %v", len(skippedMail), skippedMail)
	}
	for _, d := range desired {
		if d.Type == "MX" {
			t.Fatalf("external MX must not be in desired set")
		}
		if d.Type == "CNAME" && d.Name == "autodiscover.example.com" {
			t.Fatalf("autodiscover CNAME must be skipped when mail is external")
		}
	}
	// The web A record is still repointed.
	found := false
	for _, d := range desired {
		if d.Type == "A" && d.Name == "example.com" && d.Content == "1.2.3.4" {
			found = true
		}
	}
	if !found {
		t.Fatalf("apex A should still be repointed even when mail is external")
	}
}

type cloudflare_DesiredLite struct {
	content string
	prio    int
}
