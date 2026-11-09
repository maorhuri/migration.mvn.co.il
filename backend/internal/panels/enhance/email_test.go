package enhance

import (
	"encoding/json"
	"testing"
)

func TestResolveFromEmail(t *testing.T) {
	cases := []struct {
		pattern string
		domain  string
		want    string
	}{
		{"", "example.com", "no-reply@example.com"},
		{"", "www.Example.com", "no-reply@example.com"},
		{"no-reply@", "example.com", "no-reply@example.com"},
		{"bounces", "example.com", "bounces@example.com"},
		{"ops@central.net", "example.com", "ops@central.net"}, // full address used verbatim
		{"Postmaster@", "Shop.CO.IL", "postmaster@shop.co.il"},
	}
	for _, tc := range cases {
		if got := resolveFromEmail(tc.pattern, tc.domain); got != tc.want {
			t.Fatalf("resolveFromEmail(%q,%q) = %q, want %q", tc.pattern, tc.domain, got, tc.want)
		}
	}
}

func TestBuildFluentSMTPSettingsJSON(t *testing.T) {
	raw, err := BuildFluentSMTPSettingsJSON("no-reply@example.com", "Example", "mail.relay.net", "587", "tls", "smtpuser", "s3cret")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Must be valid JSON parseable with --format=json by WP-CLI.
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		t.Fatalf("output is not valid JSON: %v\n%s", err, raw)
	}

	conns, ok := parsed["connections"].(map[string]interface{})
	if !ok || len(conns) != 1 {
		t.Fatalf("expected exactly one connection, got %v", parsed["connections"])
	}
	conn, ok := conns["no-reply@example.com"].(map[string]interface{})
	if !ok {
		t.Fatalf("connection not keyed by sender email: %v", conns)
	}
	ps, ok := conn["provider_settings"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing provider_settings: %v", conn)
	}
	for k, want := range map[string]string{
		"provider":     "smtp",
		"mailer":       "smtp",
		"smtp_host":    "mail.relay.net",
		"smtp_port":    "587",
		"encryption":   "tls",
		"username":     "smtpuser",
		"password":     "s3cret",
		"auth":         "yes",
		"sender_email": "no-reply@example.com",
		"sender_name":  "Example",
	} {
		if got, _ := ps[k].(string); got != want {
			t.Fatalf("provider_settings[%q] = %q, want %q", k, got, want)
		}
	}

	mappings, ok := parsed["mappings"].(map[string]interface{})
	if !ok || mappings["no-reply@example.com"] != "no-reply@example.com" {
		t.Fatalf("mappings should map sender -> connection key: %v", parsed["mappings"])
	}
	misc, ok := parsed["misc"].(map[string]interface{})
	if !ok || misc["default_connection"] != "no-reply@example.com" {
		t.Fatalf("misc.default_connection should be the sender email: %v", parsed["misc"])
	}
}

func TestBuildFluentSMTPSettingsJSONDefaults(t *testing.T) {
	// No auth user -> auth "no"; blank port/encryption -> sane defaults.
	raw, err := BuildFluentSMTPSettingsJSON("ops@example.com", "", "mail.relay.net", "", "", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	ps := parsed["connections"].(map[string]interface{})["ops@example.com"].(map[string]interface{})["provider_settings"].(map[string]interface{})
	if ps["auth"] != "no" {
		t.Fatalf("auth should be 'no' without a username, got %v", ps["auth"])
	}
	if ps["smtp_port"] != "587" {
		t.Fatalf("default port should be 587, got %v", ps["smtp_port"])
	}
	if ps["encryption"] != "tls" {
		t.Fatalf("default encryption should be tls, got %v", ps["encryption"])
	}

	if _, err := BuildFluentSMTPSettingsJSON("", "", "mail.relay.net", "587", "tls", "", ""); err == nil {
		t.Fatal("expected an error when from-email is empty")
	}
	if _, err := BuildFluentSMTPSettingsJSON("ops@example.com", "", "", "587", "tls", "", ""); err == nil {
		t.Fatal("expected an error when host is empty")
	}
}
