package enhance

import (
	"encoding/json"
	"testing"
)

func TestNoReplyFor(t *testing.T) {
	cases := map[string]string{
		"example.com":     "no-reply@example.com",
		"www.Example.com": "no-reply@example.com",
		"Shop.CO.IL":      "no-reply@shop.co.il",
	}
	for in, want := range cases {
		if got := noReplyFor(in); got != want {
			t.Fatalf("noReplyFor(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildFluentSMTPSettingsJSON(t *testing.T) {
	raw, err := BuildFluentSMTPSettingsJSON("no-reply@example.com")
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
	// Zero-config: local server transport on port 25, no auth, From forced.
	for k, want := range map[string]string{
		"provider":         "smtp",
		"mailer":           "smtp",
		"smtp_host":        "localhost",
		"smtp_port":        "25",
		"auth":             "no",
		"encryption":       "none",
		"sender_email":     "no-reply@example.com",
		"force_from_email": "yes",
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

	if _, err := BuildFluentSMTPSettingsJSON(""); err == nil {
		t.Fatal("expected an error when from-email is empty")
	}
}
