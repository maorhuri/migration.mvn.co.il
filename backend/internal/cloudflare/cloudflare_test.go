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
	res, err := c.UpsertRecords(context.Background(), "zone1", existing, desired, "")
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
	res, err := c.UpsertRecords(context.Background(), "zone1", existing, desired, "")
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

// captureBatch returns a server that records the batch body it receives and answers OK.
func captureBatch(t *testing.T, body *batchRequest, called *bool) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/dns_records/batch") {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if called != nil {
			*called = true
		}
		data, _ := io.ReadAll(r.Body)
		json.Unmarshal(data, body)
		writeOK(w, map[string]interface{}{})
	}))
}

// BUG 1: once a DKIM record is stored clean (what Cloudflare keeps), a re-run that offers the same
// clean content must be a no-op -- not a re-create that trips 81058.
func TestUpsertRecordsTXTIdempotentRerun(t *testing.T) {
	clean := "v=DKIM1; k=rsa; p=MIIBIj"
	existing := []DNSRecord{{ID: "dkim", Type: "TXT", Name: "default._domainkey.example.com", Content: clean}}
	desired := []DesiredRecord{{Type: "TXT", Name: "default._domainkey.example.com", Content: clean, TTL: 3600}}
	var body batchRequest
	called := false
	srv := captureBatch(t, &body, &called)
	defer srv.Close()

	c := newTestClient(srv)
	res, err := c.UpsertRecords(context.Background(), "zone1", existing, desired, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if called {
		t.Fatalf("a clean DKIM re-run must be a no-op; the batch endpoint should not be called")
	}
	if len(res.Unchanged) != 1 || len(res.Created) != 0 || len(res.Deleted) != 0 {
		t.Fatalf("expected a single unchanged record, got %+v", res)
	}
}

// BUG 1 (DMARC): a BIND-escaped DMARC left in the zone is PATCHED to the clean content (a
// singleton by name), not duplicated and not left invalid. A later re-run (clean stored) is a
// no-op -- covered by the byte-identical branch in TestUpsertRecordsTXTIdempotentRerun.
func TestUpsertRecordsPatchesEscapedDMARCToClean(t *testing.T) {
	clean := "v=DMARC1; p=none"
	existing := []DNSRecord{{ID: "dmarc", Type: "TXT", Name: "_dmarc.example.com", Content: `v=DMARC1\; p=none\;`}}
	desired := []DesiredRecord{{Type: "TXT", Name: "_dmarc.example.com", Content: clean, TTL: 3600}}
	var body batchRequest
	srv := captureBatch(t, &body, nil)
	defer srv.Close()

	c := newTestClient(srv)
	res, err := c.UpsertRecords(context.Background(), "zone1", existing, desired, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(body.Posts) != 0 {
		t.Fatalf("must not create a second DMARC; expected a patch, got posts %+v", body.Posts)
	}
	if len(body.Patches) != 1 || body.Patches[0].ID != "dmarc" || body.Patches[0].Content != clean {
		t.Fatalf("expected the escaped DMARC patched to clean, got %+v", body.Patches)
	}
	if len(res.Updated) != 1 || len(res.Deleted) != 0 {
		t.Fatalf("expected one update and no deletes, got %+v", res)
	}
}

// BUG 1: a DKIM selector duplicated as an escaped copy AND a clean copy must collapse to exactly one
// clean record -- the clean one is kept, the escaped duplicate is deleted, nothing is created.
func TestUpsertRecordsCollapsesDuplicateDKIM(t *testing.T) {
	clean := "v=DKIM1; k=rsa; p=MIIBIj"
	existing := []DNSRecord{
		{ID: "dkim-esc", Type: "TXT", Name: "default._domainkey.example.com", Content: `v=DKIM1\; k=rsa\; p=MIIBIj`},
		{ID: "dkim-clean", Type: "TXT", Name: "default._domainkey.example.com", Content: clean},
	}
	desired := []DesiredRecord{{Type: "TXT", Name: "default._domainkey.example.com", Content: clean, TTL: 3600}}
	var body batchRequest
	srv := captureBatch(t, &body, nil)
	defer srv.Close()

	c := newTestClient(srv)
	res, err := c.UpsertRecords(context.Background(), "zone1", existing, desired, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(body.Posts) != 0 {
		t.Fatalf("must never create a second DKIM record, got posts %+v", body.Posts)
	}
	if len(body.Deletes) != 1 || body.Deletes[0].ID != "dkim-esc" {
		t.Fatalf("expected the escaped duplicate deleted, got %+v", body.Deletes)
	}
	if len(res.Unchanged) != 1 || len(res.Deleted) != 1 {
		t.Fatalf("expected one clean record kept and one deleted, got %+v", res)
	}
}

// BUG 1: when only an escaped DKIM exists, it is PATCHED to the clean content (not left invalid,
// not duplicated).
func TestUpsertRecordsPatchesEscapedDKIMToClean(t *testing.T) {
	clean := "v=DKIM1; k=rsa; p=MIIBIj"
	existing := []DNSRecord{{ID: "dkim-esc", Type: "TXT", Name: "default._domainkey.example.com", Content: `v=DKIM1\; k=rsa\; p=MIIBIj`}}
	desired := []DesiredRecord{{Type: "TXT", Name: "default._domainkey.example.com", Content: clean, TTL: 3600}}
	var body batchRequest
	srv := captureBatch(t, &body, nil)
	defer srv.Close()

	c := newTestClient(srv)
	res, err := c.UpsertRecords(context.Background(), "zone1", existing, desired, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(body.Posts) != 0 {
		t.Fatalf("must not create; expected a patch, got posts %+v", body.Posts)
	}
	if len(body.Patches) != 1 || body.Patches[0].ID != "dkim-esc" || body.Patches[0].Content != clean {
		t.Fatalf("expected the escaped record patched to clean, got %+v", body.Patches)
	}
	if len(res.Updated) != 1 {
		t.Fatalf("expected one updated, got %+v", res)
	}
}

// BUG 2: a stale apex A at the old source IP sitting next to the new target A must be removed, so
// the apex resolves only to the new IP (this is the "A 6x6.co.il = 45.83.40.67 (unexpected)" case).
func TestUpsertRecordsRemovesStaleApexDuplicate(t *testing.T) {
	oldIP, target := "45.83.40.67", "103.95.119.34"
	existing := []DNSRecord{
		{ID: "a-old", Type: "A", Name: "6x6.co.il", Content: oldIP},
		{ID: "a-new", Type: "A", Name: "6x6.co.il", Content: target},
	}
	desired := []DesiredRecord{{Type: "A", Name: "6x6.co.il", Content: target, TTL: 3600}}
	var body batchRequest
	srv := captureBatch(t, &body, nil)
	defer srv.Close()

	c := newTestClient(srv)
	res, err := c.UpsertRecords(context.Background(), "zone1", existing, desired, oldIP)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(body.Posts) != 0 || len(body.Patches) != 0 {
		t.Fatalf("target A already present; expected only a delete, got posts=%+v patches=%+v", body.Posts, body.Patches)
	}
	if len(body.Deletes) != 1 || body.Deletes[0].ID != "a-old" {
		t.Fatalf("expected the stale old-IP apex A deleted, got %+v", body.Deletes)
	}
	if len(res.Unchanged) != 1 || len(res.Deleted) != 1 || res.Deleted[0].ID != "a-old" {
		t.Fatalf("expected target kept and stale deleted, got %+v", res)
	}
}

// BUG 2: when the apex still has the old-source-IP A (alongside an unrelated A) and no target A yet,
// the stale one is PATCHED to the target -- not left, and not duplicated -- while a legitimate
// unrelated A is preserved.
func TestUpsertRecordsPatchesStaleApexAmongDuplicates(t *testing.T) {
	oldIP, target := "45.83.40.67", "103.95.119.34"
	existing := []DNSRecord{
		{ID: "a-old", Type: "A", Name: "6x6.co.il", Content: oldIP},
		{ID: "a-cdn", Type: "A", Name: "6x6.co.il", Content: "198.51.100.7"}, // legit round-robin member
	}
	desired := []DesiredRecord{{Type: "A", Name: "6x6.co.il", Content: target, TTL: 3600}}
	var body batchRequest
	srv := captureBatch(t, &body, nil)
	defer srv.Close()

	c := newTestClient(srv)
	res, err := c.UpsertRecords(context.Background(), "zone1", existing, desired, oldIP)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(body.Posts) != 0 {
		t.Fatalf("stale apex A must be reused, not duplicated; got posts %+v", body.Posts)
	}
	if len(body.Patches) != 1 || body.Patches[0].ID != "a-old" || body.Patches[0].Content != target {
		t.Fatalf("expected the stale old-IP A patched to target, got %+v", body.Patches)
	}
	for _, d := range body.Deletes {
		if d.ID == "a-cdn" {
			t.Fatalf("a legitimate non-stale round-robin A must not be deleted")
		}
	}
	if len(res.Updated) != 1 {
		t.Fatalf("expected one update, got %+v", res)
	}
}

// Single-candidate apex A at the old IP is patched over (the baseline the coordinator asked for).
func TestUpsertRecordsPatchesApexOverExisting(t *testing.T) {
	oldIP, target := "45.83.40.67", "103.95.119.34"
	existing := []DNSRecord{{ID: "a-root", Type: "A", Name: "6x6.co.il", Content: oldIP}}
	desired := []DesiredRecord{{Type: "A", Name: "6x6.co.il", Content: target, TTL: 3600}}
	var body batchRequest
	srv := captureBatch(t, &body, nil)
	defer srv.Close()

	c := newTestClient(srv)
	if _, err := c.UpsertRecords(context.Background(), "zone1", existing, desired, oldIP); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(body.Posts) != 0 {
		t.Fatalf("expected a patch, not a create: %+v", body.Posts)
	}
	if len(body.Patches) != 1 || body.Patches[0].ID != "a-root" || body.Patches[0].Content != target {
		t.Fatalf("expected apex A patched to target, got %+v", body.Patches)
	}
}

// BUG 1 resilience: if the atomic batch is still rejected with 81058, the duplicate POST is treated
// as already-present and the other records still apply (one duplicate does not abort the zone).
func TestUpsertRecordsToleratesDuplicate81058(t *testing.T) {
	desired := []DesiredRecord{
		{Type: "TXT", Name: "a.example.com", Content: "dup", TTL: 3600}, // Cloudflare already has it
		{Type: "TXT", Name: "b.example.com", Content: "new", TTL: 3600}, // genuinely new
	}
	var combinedCalls, singleCalls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		var body batchRequest
		json.Unmarshal(data, &body)
		if len(body.Posts) > 1 { // the first, combined batch -> reject with 81058
			combinedCalls++
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"success":false,"errors":[{"code":81058,"message":"failed to POST record"}]}`))
			return
		}
		singleCalls++
		if len(body.Posts) == 1 && body.Posts[0].Content == "dup" { // the duplicate -> 81058
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"success":false,"errors":[{"code":81058,"message":"an identical record already exists"}]}`))
			return
		}
		writeOK(w, map[string]interface{}{})
	}))
	defer srv.Close()

	c := newTestClient(srv)
	res, err := c.UpsertRecords(context.Background(), "zone1", nil, desired, "")
	if err != nil {
		t.Fatalf("a resilient upsert must not fail the whole zone on 81058: %v", err)
	}
	if combinedCalls != 1 || singleCalls != 2 {
		t.Fatalf("expected 1 combined + 2 single batch calls, got combined=%d single=%d", combinedCalls, singleCalls)
	}
	if len(res.Created) != 1 || res.Created[0].Content != "new" {
		t.Fatalf("only the genuinely new record should be created, got %+v", res.Created)
	}
	if len(res.Unchanged) != 1 || res.Unchanged[0].Content != "dup" {
		t.Fatalf("the duplicate should be reported unchanged, got %+v", res.Unchanged)
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
