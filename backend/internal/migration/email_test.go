package migration

import (
	"strings"
	"testing"
)

func TestBuildSPF(t *testing.T) {
	cases := []struct {
		name     string
		targetIP string
		extra    string
		want     string
	}{
		{"ip only", "203.0.113.10", "", "v=spf1 ip4:203.0.113.10 ~all"},
		{"ip + include", "203.0.113.10", "include:_spf.relay.net", "v=spf1 ip4:203.0.113.10 include:_spf.relay.net ~all"},
		{"ip + two terms", "203.0.113.10", "include:_spf.relay.net a:mx.relay.net", "v=spf1 ip4:203.0.113.10 include:_spf.relay.net a:mx.relay.net ~all"},
		{"no ip", "", "include:_spf.relay.net", "v=spf1 include:_spf.relay.net ~all"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := buildSPF(tc.targetIP, tc.extra); got != tc.want {
				t.Fatalf("buildSPF(%q,%q) = %q, want %q", tc.targetIP, tc.extra, got, tc.want)
			}
		})
	}
}

func TestMergeSPF(t *testing.T) {
	cases := []struct {
		name        string
		existing    string
		targetIP    string
		extra       string
		want        string
		wantChanged bool
	}{
		{"empty -> fresh", "", "203.0.113.10", "", "v=spf1 ip4:203.0.113.10 ~all", true},
		{"non-spf TXT -> fresh", "google-site-verification=abc", "203.0.113.10", "", "v=spf1 ip4:203.0.113.10 ~all", true},
		{
			name:        "merge ip into existing include, keep hardfail",
			existing:    "v=spf1 include:_spf.google.com -all",
			targetIP:    "203.0.113.10",
			extra:       "",
			want:        "v=spf1 include:_spf.google.com ip4:203.0.113.10 -all",
			wantChanged: true,
		},
		{
			name:        "already authorized -> unchanged",
			existing:    "v=spf1 ip4:203.0.113.10 ~all",
			targetIP:    "203.0.113.10",
			extra:       "",
			want:        "v=spf1 ip4:203.0.113.10 ~all",
			wantChanged: false,
		},
		{
			name:        "extra term already present -> unchanged",
			existing:    "v=spf1 ip4:203.0.113.10 include:_spf.relay.net ~all",
			targetIP:    "203.0.113.10",
			extra:       "include:_spf.relay.net",
			want:        "v=spf1 ip4:203.0.113.10 include:_spf.relay.net ~all",
			wantChanged: false,
		},
		{
			name:        "no all mechanism -> add soft-fail",
			existing:    "v=spf1 ip4:203.0.113.10",
			targetIP:    "203.0.113.10",
			extra:       "",
			want:        "v=spf1 ip4:203.0.113.10 ~all",
			wantChanged: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, changed := mergeSPF(tc.existing, tc.targetIP, tc.extra)
			if got != tc.want {
				t.Fatalf("mergeSPF(%q,%q,%q) = %q, want %q", tc.existing, tc.targetIP, tc.extra, got, tc.want)
			}
			if changed != tc.wantChanged {
				t.Fatalf("mergeSPF(%q,...) changed = %v, want %v", tc.existing, changed, tc.wantChanged)
			}
		})
	}

	// Idempotency: feeding the merge result back in must not change it again.
	first, _ := mergeSPF("v=spf1 include:_spf.google.com -all", "203.0.113.10", "include:_spf.relay.net")
	second, changed := mergeSPF(first, "203.0.113.10", "include:_spf.relay.net")
	if changed || first != second {
		t.Fatalf("mergeSPF not idempotent: first=%q second=%q changed=%v", first, second, changed)
	}
}

func TestBuildDMARC(t *testing.T) {
	cases := []struct {
		name   string
		policy string
		rua    string
		want   string
	}{
		{"default none, no rua", "", "", "v=DMARC1; p=none"},
		{"none with rua", "none", "dmarc@example.com", "v=DMARC1; p=none; rua=mailto:dmarc@example.com"},
		{"quarantine", "quarantine", "dmarc@example.com", "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"},
		{"reject", "reject", "", "v=DMARC1; p=reject"},
		{"invalid policy falls back to none", "bogus", "", "v=DMARC1; p=none"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := buildDMARC(tc.policy, tc.rua); got != tc.want {
				t.Fatalf("buildDMARC(%q,%q) = %q, want %q", tc.policy, tc.rua, got, tc.want)
			}
		})
	}
	if !isDMARC(buildDMARC("none", "")) {
		t.Fatal("buildDMARC output not recognized by isDMARC")
	}
	if !strings.HasPrefix(buildDMARC("reject", ""), "v=DMARC1") {
		t.Fatal("DMARC must start with v=DMARC1")
	}
}
