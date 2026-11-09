package cloudflare

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestClient points a Client at an httptest server standing in for the Cloudflare API.
func newTestClient(srv *httptest.Server) *Client {
	c := New("test-token", "")
	c.baseURL = srv.URL
	return c
}

func writeOK(w http.ResponseWriter, result interface{}) {
	w.Header().Set("Content-Type", "application/json")
	body, _ := json.Marshal(map[string]interface{}{"success": true, "errors": []interface{}{}, "result": result})
	w.Write(body)
}

func TestFindZoneForDomainWalksParents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("name")
		// Only the registrable parent exists as a zone.
		if name == "example.com" {
			writeOK(w, []Zone{{ID: "zone1", Name: "example.com", Status: "active"}})
			return
		}
		writeOK(w, []Zone{})
	}))
	defer srv.Close()

	c := newTestClient(srv)
	zone, err := c.FindZoneForDomain(context.Background(), "shop.example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if zone == nil || zone.ID != "zone1" || zone.Name != "example.com" {
		t.Fatalf("expected example.com zone, got %+v", zone)
	}
}

func TestFindZoneForDomainNotInAccount(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeOK(w, []Zone{})
	}))
	defer srv.Close()

	c := newTestClient(srv)
	zone, err := c.FindZoneForDomain(context.Background(), "notours.net")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if zone != nil {
		t.Fatalf("expected nil zone for a domain not in the account, got %+v", zone)
	}
}

func TestUpdateARecordsBatchesPatchesAndDeletes(t *testing.T) {
	records := []DNSRecord{
		{ID: "a-root", Type: "A", Name: "example.com", Content: "9.9.9.9"},      // root, old content
		{ID: "a-www", Type: "A", Name: "www.example.com", Content: "9.9.9.9"},   // www, old content
		{ID: "a-mail", Type: "A", Name: "mail.example.com", Content: "9.9.9.9"}, // points at OLD source IP
		{ID: "a-other", Type: "A", Name: "api.example.com", Content: "5.5.5.5"}, // unrelated, keep
		{ID: "aaaa-root", Type: "AAAA", Name: "example.com", Content: "::1"},    // AAAA on root -> delete
	}

	var gotBody batchRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/dns_records/batch") {
			data, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(data, &gotBody); err != nil {
				t.Fatalf("bad batch body: %v", err)
			}
			writeOK(w, map[string]interface{}{})
			return
		}
		t.Fatalf("unexpected path %s", r.URL.Path)
	}))
	defer srv.Close()

	c := newTestClient(srv)
	names := []string{"example.com", "www.example.com"}
	res, err := c.UpdateARecords(context.Background(), "zone1", records, "1.2.3.4", "", "9.9.9.9", names)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// root, www and mail (old source IP) get patched; api is untouched.
	if len(gotBody.Patches) != 3 {
		t.Fatalf("expected 3 patches, got %d: %+v", len(gotBody.Patches), gotBody.Patches)
	}
	patched := map[string]string{}
	for _, p := range gotBody.Patches {
		patched[p.ID] = p.Content
	}
	for _, id := range []string{"a-root", "a-www", "a-mail"} {
		if patched[id] != "1.2.3.4" {
			t.Fatalf("record %s not patched to new IP: %+v", id, patched)
		}
	}
	if _, ok := patched["a-other"]; ok {
		t.Fatalf("unrelated A record should not be patched")
	}
	// AAAA on root deleted (no IPv6 target).
	if len(gotBody.Deletes) != 1 || gotBody.Deletes[0].ID != "aaaa-root" {
		t.Fatalf("expected AAAA root delete, got %+v", gotBody.Deletes)
	}
	if len(res.Patched) != 3 || len(res.Deleted) != 1 {
		t.Fatalf("result summary wrong: patched=%d deleted=%d", len(res.Patched), len(res.Deleted))
	}
}

func TestUpdateARecordsNoChangeMakesNoCall(t *testing.T) {
	records := []DNSRecord{
		{ID: "a-root", Type: "A", Name: "example.com", Content: "1.2.3.4"}, // already correct
	}
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		writeOK(w, map[string]interface{}{})
	}))
	defer srv.Close()

	c := newTestClient(srv)
	res, err := c.UpdateARecords(context.Background(), "zone1", records, "1.2.3.4", "", "", []string{"example.com"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if called {
		t.Fatalf("no records changed; the batch endpoint should not be called")
	}
	if len(res.Patched) != 0 || len(res.Deleted) != 0 {
		t.Fatalf("expected empty change set, got %+v", res)
	}
}

func TestAPIErrorOnSuccessFalse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}`))
	}))
	defer srv.Close()

	c := newTestClient(srv)
	_, err := c.ListZones(context.Background())
	if err == nil {
		t.Fatal("expected an error for success:false")
	}
	ae, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if !ae.IsAuthError() {
		t.Fatalf("expected auth error, got status %d", ae.Status)
	}
}

func TestPurgeCache(t *testing.T) {
	var body map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/purge_cache") {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		data, _ := io.ReadAll(r.Body)
		json.Unmarshal(data, &body)
		writeOK(w, map[string]interface{}{"id": "zone1"})
	}))
	defer srv.Close()

	c := newTestClient(srv)
	if err := c.PurgeCache(context.Background(), "zone1"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if body["purge_everything"] != true {
		t.Fatalf("expected purge_everything true, got %+v", body)
	}
}

func TestUpsertRecordsCreatesUpdatesSkipsUnchanged(t *testing.T) {
	existing := []DNSRecord{
		{ID: "a-root", Type: "A", Name: "example.com", Content: "1.2.3.4"},                    // matches desired -> unchanged
		{ID: "cname-www", Type: "CNAME", Name: "www.example.com", Content: "old.example.com"}, // -> update
	}
	desired := []DesiredRecord{
		{Type: "A", Name: "example.com", Content: "1.2.3.4", TTL: 3600},
		{Type: "CNAME", Name: "www.example.com", Content: "example.com", TTL: 3600},
		{Type: "MX", Name: "example.com", Content: "mail.example.com", TTL: 3600, Priority: 10}, // -> create
	}
	var body batchRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/dns_records/batch") {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		data, _ := io.ReadAll(r.Body)
		json.Unmarshal(data, &body)
		writeOK(w, map[string]interface{}{})
	}))
	defer srv.Close()

	c := newTestClient(srv)
	res, err := c.UpsertRecords(context.Background(), "zone1", existing, desired)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Unchanged) != 1 || len(res.Updated) != 1 || len(res.Created) != 1 {
		t.Fatalf("counts wrong: unchanged=%d updated=%d created=%d", len(res.Unchanged), len(res.Updated), len(res.Created))
	}
	if len(body.Patches) != 1 || body.Patches[0].ID != "cname-www" || body.Patches[0].Content != "example.com" {
		t.Fatalf("expected one CNAME patch, got %+v", body.Patches)
	}
	if len(body.Posts) != 1 || body.Posts[0].Type != "MX" || body.Posts[0].Priority == nil || *body.Posts[0].Priority != 10 {
		t.Fatalf("expected one MX create with priority 10, got %+v", body.Posts)
	}
}

func TestUpsertRecordsNoChangeMakesNoCall(t *testing.T) {
	existing := []DNSRecord{{ID: "a-root", Type: "A", Name: "example.com", Content: "1.2.3.4"}}
	desired := []DesiredRecord{{Type: "A", Name: "example.com", Content: "1.2.3.4"}}
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		writeOK(w, map[string]interface{}{})
	}))
	defer srv.Close()
	c := newTestClient(srv)
	res, err := c.UpsertRecords(context.Background(), "zone1", existing, desired)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if called {
		t.Fatalf("nothing changed; batch endpoint should not be called")
	}
	if len(res.Unchanged) != 1 {
		t.Fatalf("expected 1 unchanged, got %d", len(res.Unchanged))
	}
}

func TestNormalizeHost(t *testing.T) {
	cases := map[string]string{
		"https://www.Example.com/path?x=1": "example.com",
		"WWW.example.com.":                 "example.com",
		"sub.example.com":                  "sub.example.com",
	}
	for in, want := range cases {
		if got := normalizeHost(in); got != want {
			t.Fatalf("normalizeHost(%q) = %q, want %q", in, got, want)
		}
	}
}
