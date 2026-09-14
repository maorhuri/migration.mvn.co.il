package api

import (
	"encoding/json"
	"testing"
)

func TestValidateServerRequest(t *testing.T) {
	ok := &CreateServerRequest{Name: "s", PanelType: "ftp", Host: "ftp.example.com", Username: "u", AuthMethod: "password", Password: "p", Metadata: map[string]interface{}{"site_url": "https://example.com", "ftps": true}}
	if err := validateServerRequest(ok, true); err != nil {
		t.Fatal(err)
	}
	if err := validateServerRequest(&CreateServerRequest{PanelType: "wordpress", Host: "h", Username: "u", AuthMethod: "password", Password: "p"}, true); err == nil {
		t.Fatal("wordpress without site_url must be rejected")
	}
	if err := validateServerRequest(&CreateServerRequest{PanelType: "ftp", Host: "h", Username: "u", AuthMethod: "ssh_key", SSHKeyID: "k"}, true); err == nil {
		t.Fatal("ftp with ssh key must be rejected")
	}
	if err := validateServerRequest(&CreateServerRequest{PanelType: "ftp", Host: "h", Username: "u", AuthMethod: "password", Metadata: map[string]interface{}{"site_url": "example.com"}}, false); err == nil {
		t.Fatal("site_url without scheme must be rejected")
	}
	if err := validateServerRequest(&CreateServerRequest{PanelType: "plesk", AuthMethod: "password"}, true); err == nil {
		t.Fatal("unknown panel type must be rejected")
	}
	if err := validateServerRequest(&CreateServerRequest{PanelType: "directadmin", AuthMethod: "ssh_key"}, true); err == nil {
		t.Fatal("ssh_key without key id must be rejected")
	}
	if err := validateServerRequest(&CreateServerRequest{PanelType: "Enhance", AuthMethod: "api_key"}, true); err != nil {
		t.Fatal(err)
	}
	if defaultPort("ftp") != 21 || defaultPort("wordpress") != 443 || defaultPort("directadmin") != 22 {
		t.Fatal("default ports")
	}
}

func TestMergeServerMetadata(t *testing.T) {
	current := json.RawMessage(`{"site_url":"https://a.com","ftps":false,"last_info":{"php_version":"8.1"},"last_info_at":"2026-09-14T10:00:00Z","enhance_org_id":"o"}`)
	req := &CreateServerRequest{PanelType: "ftp", Host: "ftp.a.com", Metadata: map[string]interface{}{"ftps": true, "docroot": "/public_html"}}
	decode := func(b json.RawMessage) map[string]interface{} {
		m := map[string]interface{}{}
		json.Unmarshal(b, &m)
		return m
	}
	meta := decode(mergeServerMetadata(current, req, "ftp.a.com", false))
	if meta["ftps"] != true || meta["docroot"] != "/public_html" || meta["site_url"] != "https://a.com" || meta["enhance_org_id"] != "o" {
		t.Fatalf("merge lost keys: %v", meta)
	}
	if _, ok := meta["last_info"]; !ok {
		t.Fatal("last_info must survive an unrelated update")
	}

	req.Metadata["site_url"] = "https://b.com"
	meta = decode(mergeServerMetadata(current, req, "ftp.a.com", false))
	if _, ok := meta["last_info"]; ok {
		t.Fatal("last_info must be dropped when the site URL changes")
	}

	req.Metadata["site_url"] = "https://a.com"
	meta = decode(mergeServerMetadata(current, req, "old-host", false))
	if _, ok := meta["last_info_at"]; ok {
		t.Fatal("last_info must be dropped when the host changes")
	}

	meta = decode(mergeServerMetadata(current, req, "ftp.a.com", true))
	if _, ok := meta["last_info"]; ok {
		t.Fatal("last_info must be dropped when the panel type changes")
	}

	req.Metadata = map[string]interface{}{"docroot": nil}
	meta = decode(mergeServerMetadata(json.RawMessage(`{"docroot":"/x","site_url":"https://a.com"}`), req, "ftp.a.com", false))
	if _, ok := meta["docroot"]; ok {
		t.Fatal("a null value must delete the key")
	}

	if string(mergeServerMetadata(nil, &CreateServerRequest{PanelType: "enhance", EnhanceOrgID: "org"}, "", false)) != `{"enhance_org_id":"org"}` {
		t.Fatal("enhance_org_id must be stored on create")
	}
}
