package agentless

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	callTimeout      = 150 * time.Second // one dump/archive call works ~20 s; leave room for slow hosts
	downloadAttempts = 5
	downloadIdle     = 3 * time.Minute // abort a download when no byte arrives for this long
	maxJSONBody      = 4 << 20
)

// downloadBackoff is the base wait between download attempts (attempt n waits n times this).
var downloadBackoff = 3 * time.Second

// UnreachableError means the helper could not be used over HTTP: connection refused, a WAF
// answering 403/406, a 404 (site_url does not serve the docroot), or a non-JSON body (PHP not
// executed). In FTP mode the export falls back to an lftp mirror when it sees this error.
type UnreachableError struct {
	URL    string
	Status int
	Reason string
}

func (e *UnreachableError) Error() string {
	if e.Status > 0 {
		return fmt.Sprintf("helper not reachable at %s (HTTP %d): %s", e.URL, e.Status, e.Reason)
	}
	return fmt.Sprintf("helper not reachable at %s: %s", e.URL, e.Reason)
}

// ForbiddenError is the helper's own 403: bad/expired token or a request from another IP.
type ForbiddenError struct {
	URL     string
	Message string
}

func (e *ForbiddenError) Error() string {
	return fmt.Sprintf("helper at %s refused the token: %s", e.URL, e.Message)
}

// HelperError is an {ok:false,error} answer.
type HelperError struct {
	Action  string
	Message string
}

func (e *HelperError) Error() string { return fmt.Sprintf("helper %s failed: %s", e.Action, e.Message) }

// helper is an HTTP client for one uploaded helper (file or plugin endpoint).
type helper struct {
	base     string // URL without query: .../mvn-xxx.php or .../wp-admin/admin-ajax.php
	plugin   bool   // plugin endpoint: action=mvn_migrator&mvn_action=<a>
	token    string
	client   *http.Client
	insecure bool
	logFn    LogFunc
	secrets  []string // values that must never appear in logs or errors (besides the token)
}

func newHTTPClient(insecure bool, jar http.CookieJar) *http.Client {
	tr := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   30 * time.Second,
		ResponseHeaderTimeout: callTimeout,
		ExpectContinueTimeout: 2 * time.Second,
		MaxIdleConns:          4,
		IdleConnTimeout:       60 * time.Second,
		DisableCompression:    true,                                      // downloads are verified by Content-Length
		TLSClientConfig:       &tls.Config{InsecureSkipVerify: insecure}, //nolint:gosec // opt-in after a verification failure
	}
	return &http.Client{Transport: tr, Jar: jar}
}

func newHelper(base string, plugin bool, token string, logFn LogFunc) *helper {
	return &helper{base: base, plugin: plugin, token: token, client: newHTTPClient(false, nil), logFn: logFn}
}

// redact removes the token from any text that could reach a log or an error message.
func (h *helper) redact(s string) string {
	if h.token != "" {
		s = strings.ReplaceAll(s, h.token, "***")
	}
	for _, sec := range h.secrets {
		if sec != "" {
			s = strings.ReplaceAll(s, sec, "***")
		}
	}
	return s
}

func (h *helper) url(action string, params map[string]string) string {
	q := url.Values{}
	if h.plugin {
		q.Set("action", pluginAjaxAction)
		q.Set("mvn_action", action)
	} else {
		q.Set("action", action)
	}
	q.Set("token", h.token)
	for k, v := range params {
		q.Set(k, v)
	}
	return h.base + "?" + q.Encode()
}

func (h *helper) newRequest(ctx context.Context, action string, params map[string]string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.url(action, params), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-MT-Token", h.token)
	req.Header.Set("User-Agent", "mvn-migration-tool/1.0")
	req.Header.Set("Accept", "application/json, application/octet-stream")
	req.Header.Set("Cache-Control", "no-cache")
	return req, nil
}

// do sends a request; a TLS verification failure is retried once without verification.
func (h *helper) do(req *http.Request) (*http.Response, error) {
	resp, err := h.client.Do(req)
	if err != nil && !h.insecure && isTLSError(err) {
		h.logFn("warn", fmt.Sprintf("TLS certificate of %s could not be verified (%s); continuing without verification", h.base, h.redact(shortErr(err))))
		h.insecure = true
		h.client = newHTTPClient(true, h.client.Jar)
		req2 := req.Clone(req.Context())
		resp, err = h.client.Do(req2)
	}
	return resp, err
}

func isTLSError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "x509:") || strings.Contains(msg, "tls:") || strings.Contains(msg, "certificate")
}

func shortErr(err error) string {
	if err == nil {
		return ""
	}
	var ue *url.Error
	if errors.As(err, &ue) && ue.Err != nil {
		err = ue.Err
	}
	msg := err.Error()
	if len(msg) > 160 {
		msg = msg[:160] + "..."
	}
	return msg
}

// call runs a helper action and returns the decoded JSON payload.
func (h *helper) call(ctx context.Context, action string, params map[string]string) (json.RawMessage, error) {
	cctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	req, err := h.newRequest(cctx, action, params)
	if err != nil {
		return nil, err
	}
	start := time.Now()
	resp, err := h.do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		h.logFn("info", fmt.Sprintf("helper %s: failed after %s: %s", action, time.Since(start).Round(time.Millisecond), h.redact(shortErr(err))))
		return nil, &UnreachableError{URL: h.base, Reason: h.redact(shortErr(err))}
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxJSONBody))
	elapsed := time.Since(start).Round(time.Millisecond)
	h.logFn("info", fmt.Sprintf("helper %s: HTTP %d in %s (%d bytes)", action, resp.StatusCode, elapsed, len(body)))
	if readErr != nil {
		return nil, &UnreachableError{URL: h.base, Status: resp.StatusCode, Reason: "reading the response failed: " + h.redact(shortErr(readErr))}
	}
	return h.decode(action, resp.StatusCode, body)
}

// decode classifies a helper answer.
func (h *helper) decode(action string, status int, body []byte) (json.RawMessage, error) {
	trimmed := bytes.TrimSpace(body)
	if h.plugin && string(trimmed) == "0" {
		return nil, &HelperError{Action: action, Message: "the mvn-migrator plugin endpoint is not registered (plugin not active?)"}
	}
	if status == http.StatusNotFound {
		return nil, &UnreachableError{URL: h.base, Status: status, Reason: "not found: the site URL does not serve the directory the helper was uploaded to, or a rewrite rule hides .php files"}
	}
	payload, ok := extractJSON(trimmed)
	if !ok {
		reason := "the response is not JSON"
		switch status {
		case http.StatusForbidden, http.StatusNotAcceptable, http.StatusTooManyRequests, http.StatusServiceUnavailable, 419:
			reason = "blocked by the web server or a WAF"
		}
		return nil, &UnreachableError{URL: h.base, Status: status, Reason: reason + ": " + snippet(h.redact(string(trimmed)), 200)}
	}
	var env struct {
		OK    *bool  `json:"ok"`
		Error string `json:"error"`
		Busy  bool   `json:"busy"`
	}
	if err := json.Unmarshal(payload, &env); err != nil || env.OK == nil {
		return nil, &UnreachableError{URL: h.base, Status: status, Reason: "the JSON answer is not from the helper: " + snippet(h.redact(string(payload)), 200)}
	}
	if status == http.StatusForbidden {
		return nil, &ForbiddenError{URL: h.base, Message: env.Error}
	}
	if !*env.OK && env.Busy {
		return nil, errBusy // a previous call of the same action is still running on the source
	}
	if !*env.OK {
		msg := env.Error
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d without an error message", status)
		}
		return nil, &HelperError{Action: action, Message: h.redact(msg)}
	}
	return payload, nil
}

// errBusy is the helper's answer while a previous chunked call is still running.
var errBusy = errors.New("helper busy")

// extractJSON returns the JSON object in a body, tolerating stray output before it.
func extractJSON(body []byte) (json.RawMessage, bool) {
	body = bytes.TrimPrefix(body, []byte("\xef\xbb\xbf"))
	if len(body) > 0 && body[0] == '{' && json.Valid(body) {
		return json.RawMessage(body), true
	}
	if i := bytes.IndexByte(body, '{'); i > 0 {
		candidate := bytes.TrimSpace(body[i:])
		if json.Valid(candidate) {
			return json.RawMessage(candidate), true
		}
	}
	return nil, false
}

func snippet(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}

// download fetches a temp-dir file with `get`, resuming with HTTP Range after a broken
// transfer, and verifies the final size. onProgress receives the bytes on disk so far.
func (h *helper) download(ctx context.Context, file, dest string, expected int64, onProgress func(done int64)) error {
	var lastErr error
	for attempt := 1; attempt <= downloadAttempts; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if attempt > 1 {
			wait := time.Duration(attempt-1) * downloadBackoff
			h.logFn("warn", fmt.Sprintf("download of %s attempt %d/%d failed (%s); retrying in %s", file, attempt-1, downloadAttempts, h.redact(shortErr(lastErr)), wait))
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		done, err := h.downloadOnce(ctx, file, dest, expected, onProgress)
		if err == nil {
			return nil
		}
		if done {
			return err
		}
		lastErr = err
	}
	return fmt.Errorf("download of %s failed after %d attempts: %w", file, downloadAttempts, lastErr)
}

// downloadOnce performs one (resumed) transfer. done=true means retrying is pointless.
func (h *helper) downloadOnce(ctx context.Context, file, dest string, expected int64, onProgress func(int64)) (bool, error) {
	var offset int64
	if st, err := os.Stat(dest); err == nil {
		offset = st.Size()
	}
	if expected > 0 && offset > expected {
		offset = 0
		if err := os.Truncate(dest, 0); err != nil {
			return true, err
		}
	}
	if expected > 0 && offset == expected {
		return true, nil
	}

	rctx, cancel := context.WithCancel(ctx)
	defer cancel()
	req, err := h.newRequest(rctx, "get", map[string]string{"file": file})
	if err != nil {
		return true, err
	}
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	start := time.Now()
	resp, err := h.do(req)
	if err != nil {
		if ctx.Err() != nil {
			return true, ctx.Err()
		}
		return false, &UnreachableError{URL: h.base, Reason: h.redact(shortErr(err))}
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		if offset > 0 {
			h.logFn("warn", fmt.Sprintf("server ignored the Range request for %s; downloading from the start", file))
			offset = 0
			if err := os.Truncate(dest, 0); err != nil {
				return true, err
			}
		}
	case http.StatusPartialContent:
		cr := resp.Header.Get("Content-Range")
		if !strings.HasPrefix(cr, fmt.Sprintf("bytes %d-", offset)) {
			return false, fmt.Errorf("unexpected Content-Range %q for offset %d", cr, offset)
		}
	case http.StatusRequestedRangeNotSatisfiable:
		if err := os.Truncate(dest, 0); err != nil {
			return true, err
		}
		return false, fmt.Errorf("range %d- not satisfiable (file changed on the source?)", offset)
	default:
		body, _ := io.ReadAll(io.LimitReader(resp.Body, maxJSONBody))
		if _, err := h.decode("get", resp.StatusCode, body); err != nil {
			var forb *ForbiddenError
			var herr *HelperError
			if errors.As(err, &forb) || errors.As(err, &herr) {
				return true, err
			}
			return false, err
		}
		return false, fmt.Errorf("unexpected HTTP %d for get", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); strings.Contains(ct, "text/html") {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return false, &UnreachableError{URL: h.base, Status: resp.StatusCode, Reason: "HTML instead of file data (WAF/challenge page?): " + snippet(h.redact(string(body)), 200)}
	}
	if cl := resp.ContentLength; cl >= 0 && expected > 0 && cl != expected-offset {
		return false, fmt.Errorf("Content-Length %d does not match the expected %d bytes remaining of %s", cl, expected-offset, file)
	}

	f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return true, err
	}
	// idle watchdog: cancel the request when nothing arrives for a while
	idle := time.AfterFunc(downloadIdle, cancel)
	buf := make([]byte, 256<<10)
	written := offset
	var copyErr error
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			idle.Reset(downloadIdle)
			if _, werr := f.Write(buf[:n]); werr != nil {
				copyErr = werr
				break
			}
			written += int64(n)
			if onProgress != nil {
				onProgress(written)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			copyErr = rerr
			break
		}
	}
	idle.Stop()
	if cerr := f.Close(); cerr != nil && copyErr == nil {
		copyErr = cerr
	}
	elapsed := time.Since(start).Round(time.Millisecond)
	if copyErr != nil {
		if ctx.Err() != nil {
			return true, ctx.Err()
		}
		h.logFn("info", fmt.Sprintf("helper get %s: %d bytes in %s, then: %s", file, written-offset, elapsed, h.redact(shortErr(copyErr))))
		return false, copyErr
	}
	h.logFn("info", fmt.Sprintf("helper get %s: %d bytes in %s (offset %d)", file, written-offset, elapsed, offset))
	if expected > 0 && written != expected {
		if written > expected {
			os.Truncate(dest, 0)
			return false, fmt.Errorf("received %d bytes but %s is %d bytes", written, file, expected)
		}
		return false, fmt.Errorf("transfer ended early: %d of %d bytes of %s", written, expected, file)
	}
	return true, nil
}
