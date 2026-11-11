// Package cloudflare is a small client for the parts of the Cloudflare API v4 the migration
// tool needs: finding the zone a domain lives in, repointing its A/AAAA records at the new
// server, purging the zone cache and verifying the result. It uses only net/http and
// encoding/json (no third-party dependency) and authenticates with a Bearer API token.
package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// BaseURL is the Cloudflare API v4 root.
const BaseURL = "https://api.cloudflare.com/client/v4"

// LogFunc receives log lines from the client (level: info|warn|error).
type LogFunc func(level, message string)

// Client talks to the Cloudflare API with either an API token (Bearer) or the legacy
// Global API Key (X-Auth-Email + X-Auth-Key). When email is set the key is treated as a
// Global API Key; otherwise the token is used as a Bearer API token.
type Client struct {
	token      string
	email      string
	baseURL    string
	httpClient *http.Client
	logFn      LogFunc
}

// New builds a client. Pass email="" to authenticate with an API token (Bearer); pass the
// Cloudflare account email to authenticate with that account's Global API Key instead.
func New(token, email string) *Client {
	return &Client{
		token:      strings.TrimSpace(token),
		email:      strings.TrimSpace(email),
		baseURL:    BaseURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// setAuth applies the right Cloudflare auth headers: Global API Key (X-Auth-Email + X-Auth-Key)
// when an account email is configured, otherwise a Bearer API token.
func (c *Client) setAuth(req *http.Request) {
	if c.email != "" {
		req.Header.Set("X-Auth-Email", c.email)
		req.Header.Set("X-Auth-Key", c.token)
		return
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
}

// SetLogger routes client log lines to fn.
func (c *Client) SetLogger(fn LogFunc) { c.logFn = fn }

func (c *Client) logf(level, format string, args ...interface{}) {
	if c.logFn != nil {
		c.logFn(level, fmt.Sprintf(format, args...))
	}
}

// ---------------------------------------------------------------------------
// API envelope types
// ---------------------------------------------------------------------------

// apiError is one entry in a Cloudflare error array.
type apiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// response is the common Cloudflare envelope. Result is left raw so each caller decodes its own shape.
type response struct {
	Success    bool            `json:"success"`
	Errors     []apiError      `json:"errors"`
	Messages   []apiError      `json:"messages"`
	Result     json.RawMessage `json:"result"`
	ResultInfo *resultInfo     `json:"result_info,omitempty"`
}

type resultInfo struct {
	Page       int `json:"page"`
	PerPage    int `json:"per_page"`
	Count      int `json:"count"`
	TotalCount int `json:"total_count"`
	TotalPages int `json:"total_pages"`
}

// Zone is a Cloudflare DNS zone (a domain managed in the account).
type Zone struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// DNSRecord is one DNS record in a zone.
type DNSRecord struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Name     string `json:"name"`
	Content  string `json:"content"`
	TTL      int    `json:"ttl"`
	Priority int    `json:"priority,omitempty"` // MX / SRV
	Proxied  bool   `json:"proxied"`
}

// DesiredRecord is a record the caller wants present in the zone (for UpsertRecords). Priority
// applies to MX (and is sent when non-zero). Proxied is only meaningful for A/AAAA/CNAME.
type DesiredRecord struct {
	Type     string
	Name     string
	Content  string
	TTL      int
	Priority int
	Proxied  bool
}

// APIError is a non-2xx HTTP response or a success:false body from the Cloudflare API.
type APIError struct {
	Status   int
	Method   string
	Endpoint string
	Errors   []apiError
	Body     string
}

func (e *APIError) Error() string {
	if len(e.Errors) > 0 {
		parts := make([]string, 0, len(e.Errors))
		for _, er := range e.Errors {
			parts = append(parts, fmt.Sprintf("%d %s", er.Code, er.Message))
		}
		return fmt.Sprintf("Cloudflare API %s %s failed (HTTP %d): %s", e.Method, e.Endpoint, e.Status, strings.Join(parts, "; "))
	}
	return fmt.Sprintf("Cloudflare API %s %s failed (HTTP %d): %s", e.Method, e.Endpoint, e.Status, strings.TrimSpace(e.Body))
}

// IsAuthError reports whether the error is an authentication/authorization failure (bad token).
func (e *APIError) IsAuthError() bool { return e.Status == 401 || e.Status == 403 }

// ---------------------------------------------------------------------------
// Low-level request
// ---------------------------------------------------------------------------

// apiRequest performs a JSON request with up to three attempts, retrying network failures,
// HTTP 429 (rate limit) and 5xx. It returns the decoded envelope's Result on success, or an
// *APIError when the HTTP status is >= 400 or the body reports success:false.
func (c *Client) apiRequest(ctx context.Context, method, endpoint string, body interface{}) (json.RawMessage, error) {
	const maxAttempts = 3
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		result, err := c.doAPIRequest(ctx, method, endpoint, body)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if attempt == maxAttempts || !isRetryable(err) {
			return nil, err
		}
		c.logf("warn", "Cloudflare API %s %s: %v (attempt %d/%d, retrying)", method, endpoint, err, attempt, maxAttempts)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(attempt) * 2 * time.Second):
		}
	}
	return nil, lastErr
}

func (c *Client) doAPIRequest(ctx context.Context, method, endpoint string, body interface{}) (json.RawMessage, error) {
	if c.token == "" {
		return nil, fmt.Errorf("no Cloudflare API token configured")
	}
	url := c.baseURL + endpoint

	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	c.setAuth(req)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var env response
	// A body that is not JSON (gateway error page, etc.) still needs a clear error.
	if jsonErr := json.Unmarshal(respBody, &env); jsonErr != nil {
		if resp.StatusCode >= 400 {
			return nil, &APIError{Status: resp.StatusCode, Method: method, Endpoint: endpoint, Body: string(respBody)}
		}
		return nil, fmt.Errorf("Cloudflare API %s %s: could not parse response: %w", method, endpoint, jsonErr)
	}

	if resp.StatusCode >= 400 || !env.Success {
		return nil, &APIError{Status: resp.StatusCode, Method: method, Endpoint: endpoint, Errors: env.Errors, Body: string(respBody)}
	}
	return env.Result, nil
}

func isRetryable(err error) bool {
	if ae, ok := err.(*APIError); ok {
		return ae.Status == 429 || ae.Status == 502 || ae.Status == 503 || ae.Status == 504
	}
	// Network-level failure (not an *APIError at all).
	return true
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

// ListZones returns every zone the token can see (following pagination).
func (c *Client) ListZones(ctx context.Context) ([]Zone, error) {
	var all []Zone
	page := 1
	for {
		raw, err := c.apiRequest(ctx, http.MethodGet, fmt.Sprintf("/zones?page=%d&per_page=50", page), nil)
		if err != nil {
			return nil, err
		}
		var zones []Zone
		if err := json.Unmarshal(raw, &zones); err != nil {
			return nil, fmt.Errorf("failed to decode zones: %w", err)
		}
		all = append(all, zones...)
		// The result_info is on the envelope; re-request it to know when to stop.
		info, err := c.zonePageInfo(ctx, page)
		if err != nil || info == nil || page >= info.TotalPages || info.TotalPages == 0 || len(zones) == 0 {
			break
		}
		page++
	}
	return all, nil
}

// zonePageInfo fetches just the result_info for a zones page (cheap; per_page=1) so ListZones
// knows how many pages exist without threading the envelope through apiRequest.
func (c *Client) zonePageInfo(ctx context.Context, page int) (*resultInfo, error) {
	url := c.baseURL + fmt.Sprintf("/zones?page=%d&per_page=50", page)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	c.setAuth(req)
	req.Header.Set("Accept", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var env response
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, err
	}
	return env.ResultInfo, nil
}

// FindZoneForDomain returns the zone whose name is the domain itself or a parent of it (the
// registrable domain), or (nil, nil) when no matching zone is in the account. It queries by
// name directly (most precise) and walks up the labels: foo.bar.example.com -> example.com.
func (c *Client) FindZoneForDomain(ctx context.Context, domain string) (*Zone, error) {
	domain = normalizeHost(domain)
	if domain == "" {
		return nil, fmt.Errorf("empty domain")
	}
	labels := strings.Split(domain, ".")
	// Try the full name first, then each parent suffix down to the last two labels.
	for i := 0; i+1 < len(labels); i++ {
		candidate := strings.Join(labels[i:], ".")
		raw, err := c.apiRequest(ctx, http.MethodGet, "/zones?name="+candidate+"&per_page=1", nil)
		if err != nil {
			return nil, err
		}
		var zones []Zone
		if err := json.Unmarshal(raw, &zones); err != nil {
			return nil, fmt.Errorf("failed to decode zones: %w", err)
		}
		if len(zones) > 0 {
			z := zones[0]
			return &z, nil
		}
	}
	return nil, nil
}

// ---------------------------------------------------------------------------
// DNS records
// ---------------------------------------------------------------------------

// ListDNSRecords returns every A and AAAA record in a zone.
func (c *Client) ListDNSRecords(ctx context.Context, zoneID string) ([]DNSRecord, error) {
	var all []DNSRecord
	for _, typ := range []string{"A", "AAAA"} {
		page := 1
		for {
			raw, err := c.apiRequest(ctx, http.MethodGet, fmt.Sprintf("/zones/%s/dns_records?type=%s&page=%d&per_page=100", zoneID, typ, page), nil)
			if err != nil {
				return nil, err
			}
			var recs []DNSRecord
			if err := json.Unmarshal(raw, &recs); err != nil {
				return nil, fmt.Errorf("failed to decode DNS records: %w", err)
			}
			all = append(all, recs...)
			if len(recs) < 100 {
				break
			}
			page++
		}
	}
	return all, nil
}

// ListAllDNSRecords returns every DNS record in a zone, regardless of type (used to replicate a
// full zone idempotently: existing records are matched so a re-run does not duplicate them).
func (c *Client) ListAllDNSRecords(ctx context.Context, zoneID string) ([]DNSRecord, error) {
	var all []DNSRecord
	page := 1
	for {
		raw, err := c.apiRequest(ctx, http.MethodGet, fmt.Sprintf("/zones/%s/dns_records?page=%d&per_page=100", zoneID, page), nil)
		if err != nil {
			return nil, err
		}
		var recs []DNSRecord
		if err := json.Unmarshal(raw, &recs); err != nil {
			return nil, fmt.Errorf("failed to decode DNS records: %w", err)
		}
		all = append(all, recs...)
		if len(recs) < 100 {
			break
		}
		page++
	}
	return all, nil
}

// batchPatch is one entry in a dns_records/batch "patches" array: change a record by id. Only
// the fields set are changed (Cloudflare merges); priority is sent for MX.
type batchPatch struct {
	ID       string `json:"id"`
	Content  string `json:"content"`
	Priority *int   `json:"priority,omitempty"`
}

// batchPost is one entry in a dns_records/batch "posts" array: create a new record.
type batchPost struct {
	Type     string `json:"type"`
	Name     string `json:"name"`
	Content  string `json:"content"`
	TTL      int    `json:"ttl,omitempty"`
	Priority *int   `json:"priority,omitempty"`
	Proxied  bool   `json:"proxied"`
}

type batchRequest struct {
	Deletes []batchDelete `json:"deletes,omitempty"`
	Patches []batchPatch  `json:"patches,omitempty"`
	Posts   []batchPost   `json:"posts,omitempty"`
}

type batchDelete struct {
	ID string `json:"id"`
}

// UpdateResult reports what UpdateARecords did for a zone.
type UpdateResult struct {
	Patched     []DNSRecord // records whose content was changed (with their NEW content)
	Deleted     []DNSRecord // AAAA records removed because no IPv6 target was available
	SkippedName []DNSRecord // apex/www records left untouched because they point at neither the source nor the target (the site is hosted elsewhere)
}

// UpdateARecords repoints DNS records in one batch, verifying what @/www point at before touching
// them so a domain whose site is actually hosted elsewhere is never repointed by name:
//   - every A record currently pointing at oldIPv4 (the source server) is set to newIPv4 — this
//     covers the apex, www and any subdomain that genuinely lived on the source;
//   - an A record on one of `names` (apex/www) that points at NEITHER the source nor the target is
//     left untouched and returned in SkippedName: the site is hosted on another server, so blindly
//     repointing it by name would break it. Only when oldIPv4 is unknown (empty) is there no safe
//     signal, and the apex/www are then repointed by name as a best effort;
//   - AAAA records on `names` are set to newIPv6 (when non-empty) or deleted, but ONLY for a name
//     confirmed to be on the source — otherwise the AAAA belongs to the site hosted elsewhere and
//     is left alone, in step with its A record.
//
// `names` are fully-qualified record names (the zone apex and www.<zone>). records is the current
// record set from ListDNSRecords. It returns what changed; an empty change set makes no API call.
func (c *Client) UpdateARecords(ctx context.Context, zoneID string, records []DNSRecord, newIPv4, newIPv6, oldIPv4 string, names []string) (*UpdateResult, error) {
	norm := func(n string) string { return strings.ToLower(strings.TrimSuffix(n, ".")) }
	nameSet := map[string]bool{}
	for _, n := range names {
		nameSet[norm(n)] = true
	}

	// A name among apex/www is "ours" to repoint only when we can confirm it was on the source
	// server: its current A record points at oldIPv4. When oldIPv4 is unknown we cannot verify, so
	// we fall back to treating every apex/www name as ours (best effort, old behaviour).
	onSource := map[string]bool{}
	if oldIPv4 == "" {
		for n := range nameSet {
			onSource[n] = true
		}
	} else {
		for _, rec := range records {
			if rec.Type == "A" && nameSet[norm(rec.Name)] && rec.Content == oldIPv4 {
				onSource[norm(rec.Name)] = true
			}
		}
	}

	res := &UpdateResult{}
	var req batchRequest
	for _, rec := range records {
		name := norm(rec.Name)
		matchName := nameSet[name]
		switch rec.Type {
		case "A":
			atOld := oldIPv4 != "" && rec.Content == oldIPv4
			switch {
			case rec.Content == newIPv4:
				// already at the target
			case atOld || (matchName && onSource[name]):
				req.Patches = append(req.Patches, batchPatch{ID: rec.ID, Content: newIPv4})
				updated := rec
				updated.Content = newIPv4
				res.Patched = append(res.Patched, updated)
			case matchName:
				// apex/www pointing at some other server: the site is hosted elsewhere -> do not
				// repoint it by name; surface it so the operator can check.
				res.SkippedName = append(res.SkippedName, rec)
			}
		case "AAAA":
			if !matchName || !onSource[name] {
				continue
			}
			if newIPv6 != "" {
				if rec.Content != newIPv6 {
					req.Patches = append(req.Patches, batchPatch{ID: rec.ID, Content: newIPv6})
					updated := rec
					updated.Content = newIPv6
					res.Patched = append(res.Patched, updated)
				}
			} else {
				req.Deletes = append(req.Deletes, batchDelete{ID: rec.ID})
				res.Deleted = append(res.Deleted, rec)
			}
		}
	}

	if len(req.Patches) == 0 && len(req.Deletes) == 0 {
		return res, nil
	}
	if _, err := c.apiRequest(ctx, http.MethodPost, "/zones/"+zoneID+"/dns_records/batch", req); err != nil {
		return nil, err
	}
	return res, nil
}

// DeleteRecords removes the records with the given ids in one batch. A no-op for an empty list.
func (c *Client) DeleteRecords(ctx context.Context, zoneID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	var req batchRequest
	for _, id := range ids {
		req.Deletes = append(req.Deletes, batchDelete{ID: id})
	}
	_, err := c.apiRequest(ctx, http.MethodPost, "/zones/"+zoneID+"/dns_records/batch", req)
	return err
}

// UpsertResult reports what UpsertRecords did.
type UpsertResult struct {
	Created   []DesiredRecord
	Updated   []DesiredRecord
	Unchanged []DesiredRecord
	Deleted   []DNSRecord // stale records removed (an old-source-IP A/AAAA, or a duplicate SPF/DKIM/DMARC)
}

func eqName(a, b string) bool {
	return strings.EqualFold(strings.TrimSuffix(a, "."), strings.TrimSuffix(b, "."))
}

// decodeTXT reduces a TXT value to the plain form a DNS provider stores, so idempotency
// comparisons match regardless of zone-file quoting/escaping: it concatenates the character-
// strings (`"a" "b"` -> `ab`), removes BIND backslash escaping (`\;` -> `;`, `\"` -> `"`,
// `\\` -> `\`, and `\X` -> `X` otherwise), and trims trailing separators.
func decodeTXT(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if !strings.ContainsAny(s, "\"\\") {
		return strings.TrimRight(s, "; \t")
	}
	var b strings.Builder
	inQuote := false
	sawQuote := false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch == '\\' && i+1 < len(s) {
			b.WriteByte(s[i+1])
			i++
			continue
		}
		if ch == '"' {
			inQuote = !inQuote
			sawQuote = true
			continue
		}
		if sawQuote && !inQuote {
			continue
		}
		b.WriteByte(ch)
	}
	return strings.TrimRight(b.String(), "; \t")
}

// sameContent reports whether an existing record's content already matches a desired one, tolerant
// of representation differences a provider normalizes away: TXT is compared after decoding
// quoting/escaping; hostname-valued types are compared case- and trailing-dot-insensitively.
func sameContent(typ, existing, desired string) bool {
	switch strings.ToUpper(typ) {
	case "TXT":
		return decodeTXT(existing) == decodeTXT(desired)
	case "CNAME", "MX", "NS":
		return strings.EqualFold(strings.TrimSuffix(strings.TrimSpace(existing), "."), strings.TrimSuffix(strings.TrimSpace(desired), "."))
	default:
		return strings.TrimSpace(existing) == strings.TrimSpace(desired)
	}
}

// isDKIMName reports whether a record name is a DKIM selector (`<selector>._domainkey.<domain>`).
func isDKIMName(name string) bool {
	for _, label := range strings.Split(strings.ToLower(strings.Trim(name, ".")), ".") {
		if label == "_domainkey" {
			return true
		}
	}
	return false
}

// isDMARCName reports whether a record name is a DMARC policy name (`_dmarc.<domain>`).
func isDMARCName(name string) bool {
	name = strings.ToLower(strings.Trim(name, "."))
	return name == "_dmarc" || strings.HasPrefix(name, "_dmarc.")
}

// apiErrHasCode reports whether err is a Cloudflare APIError carrying the given error code.
func apiErrHasCode(err error, code int) bool {
	if ae, ok := err.(*APIError); ok {
		for _, e := range ae.Errors {
			if e.Code == code {
				return true
			}
		}
	}
	return false
}

// isRecordExistsErr reports whether a batch error is the "record is already there" family, which on
// a POST (create) means the record (or a conflicting one at the same host) already exists and the
// create can be safely skipped rather than aborting the whole zone:
//   - 81053: an A/AAAA/CNAME record with that host already exists (type conflict)
//   - 81057: record already exists
//   - 81058: an identical record already exists
func isRecordExistsErr(err error) bool {
	return apiErrHasCode(err, 81053) || apiErrHasCode(err, 81057) || apiErrHasCode(err, 81058)
}

// UpsertRecords makes the zone contain every record in `desired`, in one batch and idempotently:
//   - a desired record already present unchanged (same type, name, content and — for MX — priority)
//     is left alone (reported in Unchanged); content is compared tolerantly (TXT after decoding
//     BIND quoting/escaping; hostnames case- and trailing-dot-insensitively);
//   - SPF, DKIM (`*._domainkey`) and DMARC (`_dmarc`) TXT records are SINGLETON-by-name: the
//     record at that name is PATCHED to the clean content and any duplicate copies (e.g. an
//     escaped leftover from an earlier run) are removed, so a selector never gets a second record;
//   - a desired record whose (type, name) exists but with different content is otherwise PATCHED
//     (CNAME: the single record at that name; MX: the record at the same priority; A/AAAA: an
//     existing record still at the old source IP, else the single record at that name — when
//     several exist and none is stale/matching, a new one is created so a real round-robin set is
//     never clobbered);
//   - anything else is CREATED.
//
// It also removes any stale A/AAAA still pointing at `oldIP` at a name it is repointing, so the
// apex/www resolve only to the new IP even if an earlier run left a duplicate. If the atomic batch
// is rejected because a POST duplicates an existing record (Cloudflare 81058), it reapplies the
// patches/deletes and posts the rest one at a time, treating a duplicate as already-present rather
// than failing the whole zone. `existing` is the current full record set (ListAllDNSRecords);
// pass oldIP="" when there is no source IP to repoint from.
func (c *Client) UpsertRecords(ctx context.Context, zoneID string, existing []DNSRecord, desired []DesiredRecord, oldIP string) (*UpsertResult, error) {
	res := &UpsertResult{}
	var req batchRequest

	isSPF := func(s string) bool {
		return strings.HasPrefix(strings.ToLower(strings.TrimSpace(strings.Trim(s, `"`))), "v=spf1")
	}
	consumed := map[string]bool{} // existing record ids patched or deleted this run

	for _, d := range desired {
		// Candidates: existing records of the same type at the same name.
		var cands []DNSRecord
		for _, e := range existing {
			if strings.EqualFold(e.Type, d.Type) && eqName(e.Name, d.Name) {
				cands = append(cands, e)
			}
		}

		// Singleton TXT (SPF, and DKIM/DMARC by name): exactly one clean record must remain at the
		// name. Patch one to the clean content and delete the rest (never create a second).
		if strings.EqualFold(d.Type, "TXT") && (isSPF(d.Content) || isDKIMName(d.Name) || isDMARCName(d.Name)) {
			group := cands
			if isSPF(d.Content) {
				group = nil // an apex may also carry unrelated TXT; only collapse the SPF records
				for _, e := range cands {
					if isSPF(e.Content) {
						group = append(group, e)
					}
				}
			}
			keep := -1
			for i, e := range group { // prefer a record already byte-identical to the clean value
				if e.Content == d.Content {
					keep = i
					break
				}
			}
			switch {
			case keep >= 0:
				res.Unchanged = append(res.Unchanged, d)
			case len(group) > 0:
				keep = 0
				req.Patches = append(req.Patches, batchPatch{ID: group[0].ID, Content: d.Content})
				res.Updated = append(res.Updated, d)
				consumed[group[0].ID] = true
			default:
				req.Posts = append(req.Posts, batchPost{Type: "TXT", Name: d.Name, Content: d.Content, TTL: d.TTL, Proxied: d.Proxied})
				res.Created = append(res.Created, d)
			}
			for i, e := range group {
				if i == keep || consumed[e.ID] {
					continue
				}
				req.Deletes = append(req.Deletes, batchDelete{ID: e.ID})
				res.Deleted = append(res.Deleted, e)
				consumed[e.ID] = true
			}
			continue
		}

		// Already present exactly? (content tolerantly, and priority for MX)
		exact := false
		for _, e := range cands {
			if sameContent(d.Type, e.Content, d.Content) && (!strings.EqualFold(d.Type, "MX") || e.Priority == d.Priority) {
				exact = true
				break
			}
		}
		if exact {
			res.Unchanged = append(res.Unchanged, d)
			continue
		}

		// Decide patch target.
		var patchID string
		switch strings.ToUpper(d.Type) {
		case "CNAME":
			if len(cands) >= 1 {
				patchID = cands[0].ID
			}
		case "MX":
			for _, e := range cands {
				if e.Priority == d.Priority {
					patchID = e.ID
					break
				}
			}
		case "TXT":
			// non-singleton TXT with no exact match: always create (do not clobber unrelated TXT).
		case "A", "AAAA":
			// Prefer repointing a stale record still at the old source IP, so a leftover
			// old-server record is reused instead of duplicated; else patch the sole record; with
			// several unrelated records, create so a legitimate round-robin set is preserved.
			if oldIP != "" {
				for _, e := range cands {
					if e.Content == oldIP {
						patchID = e.ID
						break
					}
				}
			}
			if patchID == "" && len(cands) == 1 {
				patchID = cands[0].ID
			}
		default: // SRV, CAA, others: no exact match -> create.
		}

		if patchID != "" {
			p := batchPatch{ID: patchID, Content: d.Content}
			if strings.EqualFold(d.Type, "MX") {
				prio := d.Priority
				p.Priority = &prio
			}
			req.Patches = append(req.Patches, p)
			res.Updated = append(res.Updated, d)
			consumed[patchID] = true
		} else {
			post := batchPost{Type: strings.ToUpper(d.Type), Name: d.Name, Content: d.Content, TTL: d.TTL, Proxied: d.Proxied}
			if strings.EqualFold(d.Type, "MX") || (strings.EqualFold(d.Type, "SRV") && d.Priority > 0) {
				prio := d.Priority
				post.Priority = &prio
			}
			req.Posts = append(req.Posts, post)
			res.Created = append(res.Created, d)
		}
	}

	// Remove any stale A/AAAA still pointing at the old source IP at a name we repointed, so the
	// apex/www resolve only to the new IP even when an earlier run left a duplicate next to the new
	// record (a legitimate new-server round-robin is never at the old IP, so it is preserved).
	if oldIP != "" {
		repoint := map[string]bool{}
		for _, d := range desired {
			if strings.EqualFold(d.Type, "A") || strings.EqualFold(d.Type, "AAAA") {
				repoint[strings.ToLower(strings.TrimSuffix(d.Name, "."))] = true
			}
		}
		for _, e := range existing {
			if consumed[e.ID] {
				continue
			}
			if (strings.EqualFold(e.Type, "A") || strings.EqualFold(e.Type, "AAAA")) &&
				e.Content == oldIP && repoint[strings.ToLower(strings.TrimSuffix(e.Name, "."))] {
				req.Deletes = append(req.Deletes, batchDelete{ID: e.ID})
				res.Deleted = append(res.Deleted, e)
				consumed[e.ID] = true
			}
		}
	}

	if len(req.Patches) == 0 && len(req.Posts) == 0 && len(req.Deletes) == 0 {
		return res, nil
	}
	if _, err := c.apiRequest(ctx, http.MethodPost, "/zones/"+zoneID+"/dns_records/batch", req); err != nil {
		if isRecordExistsErr(err) && len(req.Posts) > 0 {
			return c.upsertTolerant(ctx, zoneID, req, res)
		}
		return nil, err
	}
	return res, nil
}

// upsertTolerant retries a batch that Cloudflare rejected with the "record already exists" family
// (81053 host conflict / 81057 / 81058). Patches and deletes (which do not trip those) are reapplied
// together -- so the apex-A repoint and stale-record cleanups still happen -- and the posts are then
// sent one at a time so a single record that already exists or conflicts is treated as already
// present (moved to Unchanged) instead of aborting the whole zone.
func (c *Client) upsertTolerant(ctx context.Context, zoneID string, req batchRequest, res *UpsertResult) (*UpsertResult, error) {
	if len(req.Patches) > 0 || len(req.Deletes) > 0 {
		pd := batchRequest{Patches: req.Patches, Deletes: req.Deletes}
		if _, err := c.apiRequest(ctx, http.MethodPost, "/zones/"+zoneID+"/dns_records/batch", pd); err != nil {
			return nil, err
		}
	}
	var created []DesiredRecord
	for i, post := range req.Posts {
		one := batchRequest{Posts: []batchPost{post}}
		if _, err := c.apiRequest(ctx, http.MethodPost, "/zones/"+zoneID+"/dns_records/batch", one); err != nil {
			if isRecordExistsErr(err) {
				c.logf("info", "Cloudflare: %s %s already exists (or conflicts with an existing record at that host); leaving it as is", post.Type, post.Name)
				res.Unchanged = append(res.Unchanged, res.Created[i])
				continue
			}
			return nil, err
		}
		created = append(created, res.Created[i])
	}
	res.Created = created
	return res, nil
}

// ---------------------------------------------------------------------------
// Cache purge + verify
// ---------------------------------------------------------------------------

// PurgeCache purges everything cached for a zone.
func (c *Client) PurgeCache(ctx context.Context, zoneID string) error {
	_, err := c.apiRequest(ctx, http.MethodPost, "/zones/"+zoneID+"/purge_cache", map[string]interface{}{"purge_everything": true})
	return err
}

// VerifyResult is the state of one record name after the update.
type VerifyResult struct {
	Name    string
	Type    string
	Content string
	OK      bool // content equals the expected IP
}

// Verify re-reads the zone's A (and AAAA) records and reports, for each requested name, whether
// it now resolves (in Cloudflare's own data) to the expected IP. This reads the authoritative
// records back from the API rather than trusting the write response.
func (c *Client) Verify(ctx context.Context, zoneID, expectedIPv4, expectedIPv6 string, names []string) ([]VerifyResult, error) {
	records, err := c.ListDNSRecords(ctx, zoneID)
	if err != nil {
		return nil, err
	}
	nameSet := map[string]bool{}
	for _, n := range names {
		nameSet[strings.ToLower(strings.TrimSuffix(n, "."))] = true
	}
	var out []VerifyResult
	for _, rec := range records {
		name := strings.ToLower(strings.TrimSuffix(rec.Name, "."))
		if !nameSet[name] {
			continue
		}
		switch rec.Type {
		case "A":
			out = append(out, VerifyResult{Name: rec.Name, Type: rec.Type, Content: rec.Content, OK: rec.Content == expectedIPv4})
		case "AAAA":
			ok := expectedIPv6 != "" && rec.Content == expectedIPv6
			out = append(out, VerifyResult{Name: rec.Name, Type: rec.Type, Content: rec.Content, OK: ok})
		}
	}
	return out, nil
}

// normalizeHost lowercases a host, strips scheme/path and a leading "www." and trailing dots.
func normalizeHost(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimPrefix(s, "www.")
	return strings.Trim(s, ".")
}
