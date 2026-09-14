package agentless

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/publicsuffix"
)

// BlockedUploadError means wp-admin refuses plugin uploads (DISALLOW_FILE_MODS, a missing
// capability, or a host that blocks update.php); the operator has to install the plugin by hand.
type BlockedUploadError struct {
	SiteURL string
	Reason  string
	ZipPath string
}

func (e *BlockedUploadError) Error() string {
	return fmt.Sprintf("plugin upload is blocked on %s (%s). Upload the plugin manually: download %s, install it from Plugins > Add New > Upload Plugin (or unzip it into wp-content/plugins/), activate it and run the connection test again",
		e.SiteURL, e.Reason, e.ZipPath)
}

// wpClient drives wp-admin with a cookie session.
type wpClient struct {
	siteURL  string // https://example.com (no trailing slash)
	client   *http.Client
	insecure bool // TLS verification was switched off after a certificate failure
	logFn    LogFunc
	user     string
	pass     string
}

func newWPClient(siteURL, user, pass string, logFn LogFunc) (*wpClient, error) {
	jar, err := cookiejar.New(&cookiejar.Options{PublicSuffixList: publicsuffix.List})
	if err != nil {
		return nil, err
	}
	w := &wpClient{siteURL: strings.TrimRight(siteURL, "/"), user: user, pass: pass, logFn: logFn}
	w.client = newHTTPClient(false, jar)
	w.client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("too many redirects")
		}
		return nil
	}
	w.client.Timeout = 3 * time.Minute
	return w, nil
}

func (w *wpClient) redact(s string) string {
	if w.pass == "" {
		return s
	}
	return strings.ReplaceAll(s, w.pass, "***")
}

func (w *wpClient) adminURL(p string) string {
	return w.siteURL + "/wp-admin/" + strings.TrimLeft(p, "/")
}

// page is a fetched wp-admin page.
type page struct {
	status int
	url    string
	body   string
}

func (w *wpClient) fetch(ctx context.Context, method, target string, body io.Reader, contentType string) (*page, error) {
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; mvn-migration-tool/1.0)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	start := time.Now()
	resp, err := w.client.Do(req)
	if err != nil && !w.insecure && isTLSError(err) {
		w.logFn("warn", fmt.Sprintf("TLS certificate of %s could not be verified (%s); continuing without verification", w.siteURL, shortErr(err)))
		w.insecure = true
		w.client = newHTTPClient(true, w.client.Jar)
		w.client.Timeout = 3 * time.Minute
		req2, _ := http.NewRequestWithContext(ctx, method, target, body)
		req2.Header = req.Header
		resp, err = w.client.Do(req2)
	}
	if err != nil {
		return nil, fmt.Errorf("%s %s: %s", method, stripQuery(target), w.redact(shortErr(err)))
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	w.logFn("info", fmt.Sprintf("wp-admin %s %s: HTTP %d in %s (%d bytes)", method, stripQuery(target), resp.StatusCode, time.Since(start).Round(time.Millisecond), len(data)))
	return &page{status: resp.StatusCode, url: resp.Request.URL.String(), body: string(data)}, nil
}

func stripQuery(u string) string {
	if i := strings.Index(u, "?"); i >= 0 {
		return u[:i]
	}
	return u
}

func (w *wpClient) postForm(ctx context.Context, target string, form url.Values) (*page, error) {
	return w.fetch(ctx, http.MethodPost, target, strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
}

// loggedIn reports whether the jar holds a WordPress login cookie for the site.
func (w *wpClient) loggedIn() bool {
	u, err := url.Parse(w.siteURL + "/wp-admin/")
	if err != nil {
		return false
	}
	for _, c := range w.client.Jar.Cookies(u) {
		if strings.HasPrefix(c.Name, "wordpress_logged_in_") {
			return true
		}
	}
	return false
}

var loginErrorRe = regexp.MustCompile(`(?s)<div[^>]*id="login_error"[^>]*>(.*?)</div>`)
var tagRe = regexp.MustCompile(`<[^>]+>`)

func stripTags(s string) string {
	return strings.Join(strings.Fields(html.UnescapeString(tagRe.ReplaceAllString(s, " "))), " ")
}

// login signs in through wp-login.php.
func (w *wpClient) login(ctx context.Context) error {
	loginURL := w.siteURL + "/wp-login.php"
	if u, err := url.Parse(w.siteURL); err == nil {
		w.client.Jar.SetCookies(u, []*http.Cookie{{Name: "wordpress_test_cookie", Value: "WP Cookie check", Path: "/"}})
	}
	p, err := w.fetch(ctx, http.MethodGet, loginURL, nil, "")
	if err != nil {
		return fmt.Errorf("wp-login.php is not reachable: %w", err)
	}
	if p.status == http.StatusNotFound || !strings.Contains(p.body, `name="log"`) {
		return fmt.Errorf("wp-login.php at %s does not show the WordPress login form (HTTP %d): a custom login URL plugin, a WAF or a wrong site URL; final URL %s", w.siteURL, p.status, stripQuery(p.url))
	}
	form := url.Values{
		"log":         {w.user},
		"pwd":         {w.pass},
		"wp-submit":   {"Log In"},
		"redirect_to": {w.siteURL + "/wp-admin/"},
		"testcookie":  {"1"},
	}
	p, err = w.postForm(ctx, loginURL, form)
	if err != nil {
		return fmt.Errorf("login request failed: %w", err)
	}
	if w.loggedIn() {
		return nil
	}
	if m := loginErrorRe.FindStringSubmatch(p.body); m != nil {
		return fmt.Errorf("WordPress refused the login for %s: %s", w.user, stripTags(m[1]))
	}
	lower := strings.ToLower(p.body)
	if strings.Contains(lower, "two-factor") || strings.Contains(lower, "authentication code") || strings.Contains(lower, "2fa") {
		return fmt.Errorf("the account %s requires two-factor authentication; disable it for the migration or use an FTP source", w.user)
	}
	return fmt.Errorf("login as %s did not produce a WordPress session (HTTP %d at %s); check the credentials and that wp-admin is not protected by another login", w.user, p.status, stripQuery(p.url))
}

var nonceRes = []*regexp.Regexp{
	regexp.MustCompile(`name="_wpnonce"[^>]*?value="([0-9a-fA-F]+)"`),
	regexp.MustCompile(`value="([0-9a-fA-F]+)"[^>]*?name="_wpnonce"`),
}

// findNonce returns the first _wpnonce hidden field of a page (preferring the given form id).
func findNonce(body, formID string) string {
	scope := body
	if formID != "" {
		if i := strings.Index(body, `id="`+formID+`"`); i >= 0 {
			if j := strings.Index(body[i:], "</form>"); j > 0 {
				scope = body[i : i+j]
			} else {
				scope = body[i:]
			}
		}
	}
	for _, re := range nonceRes {
		if m := re.FindStringSubmatch(scope); m != nil {
			return m[1]
		}
	}
	if scope != body {
		return findNonce(body, "")
	}
	return ""
}

var hrefRe = regexp.MustCompile(`href="([^"]*plugins\.php\?[^"]*)"`)

// findPluginLink returns the decoded plugins.php link with the given action for our plugin.
func findPluginLink(body, action string) string {
	for _, m := range hrefRe.FindAllStringSubmatch(body, -1) {
		link := html.UnescapeString(m[1])
		if !strings.Contains(link, "action="+action) {
			continue
		}
		if strings.Contains(link, "plugin=mvn-migrator%2Fmvn-migrator.php") || strings.Contains(link, "plugin=mvn-migrator/mvn-migrator.php") {
			return link
		}
	}
	return ""
}

func (w *wpClient) resolveAdminLink(link string) string {
	if strings.HasPrefix(link, "http://") || strings.HasPrefix(link, "https://") {
		return link
	}
	if strings.HasPrefix(link, "/") {
		return w.siteURL + link
	}
	return w.adminURL(link)
}

func pluginListed(body string) bool {
	return strings.Contains(body, `data-plugin="`+pluginFile+`"`) || strings.Contains(body, `data-slug="`+pluginSlug+`"`)
}

func isNotAllowed(p *page) bool {
	if p.status == http.StatusForbidden {
		return true
	}
	lower := strings.ToLower(p.body)
	return strings.Contains(lower, "you are not allowed") || strings.Contains(lower, "disallow_file_mods")
}

// installPlugin uploads the plugin zip through wp-admin (overwriting a previous copy) and
// activates it. It returns *BlockedUploadError when the site refuses uploads.
func (w *wpClient) installPlugin(ctx context.Context, zipData []byte, zipPath string) error {
	p, err := w.fetch(ctx, http.MethodGet, w.adminURL("plugin-install.php?tab=upload"), nil, "")
	if err != nil {
		return err
	}
	if isNotAllowed(p) {
		return &BlockedUploadError{SiteURL: w.siteURL, Reason: "wp-admin answers 'not allowed' on the plugin upload page: DISALLOW_FILE_MODS or the user lacks install_plugins", ZipPath: zipPath}
	}
	nonce := findNonce(p.body, "plugin-upload-form")
	if nonce == "" || !strings.Contains(p.body, "pluginzip") {
		return &BlockedUploadError{SiteURL: w.siteURL, Reason: fmt.Sprintf("the upload form is missing on plugin-install.php (HTTP %d): uploads are disabled for this site or user", p.status), ZipPath: zipPath}
	}

	upload := func(overwrite bool) (*page, error) {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		mw.WriteField("_wpnonce", nonce)
		mw.WriteField("_wp_http_referer", "/wp-admin/plugin-install.php?tab=upload")
		if overwrite {
			mw.WriteField("overwrite", "update-plugin")
		}
		fw, err := mw.CreateFormFile("pluginzip", pluginSlug+".zip")
		if err != nil {
			return nil, err
		}
		fw.Write(zipData)
		mw.WriteField("install-plugin-submit", "Install Now")
		mw.Close()
		return w.fetch(ctx, http.MethodPost, w.adminURL("update.php?action=upload-plugin"), &buf, mw.FormDataContentType())
	}
	p, err = upload(false)
	if err != nil {
		return err
	}
	if isNotAllowed(p) {
		return &BlockedUploadError{SiteURL: w.siteURL, Reason: "update.php refused the upload (HTTP " + fmt.Sprint(p.status) + ")", ZipPath: zipPath}
	}
	if strings.Contains(p.body, `name="overwrite"`) && strings.Contains(p.body, `value="update-plugin"`) {
		w.logFn("info", "A previous copy of the plugin exists on the site; replacing it")
		if p, err = upload(true); err != nil {
			return err
		}
	}

	// activate: link on the install result page, else on plugins.php
	link := findPluginLink(p.body, "activate")
	if link == "" {
		lp, err := w.fetch(ctx, http.MethodGet, w.adminURL("plugins.php?plugin_status=all"), nil, "")
		if err != nil {
			return err
		}
		if !pluginListed(lp.body) {
			return fmt.Errorf("the plugin upload did not install mvn-migrator (HTTP %d from update.php: %s)", p.status, snippet(stripTags(p.body), 300))
		}
		if findPluginLink(lp.body, "deactivate") != "" {
			w.logFn("info", "mvn-migrator plugin is already active")
			return nil
		}
		link = findPluginLink(lp.body, "activate")
	}
	if link == "" {
		return fmt.Errorf("mvn-migrator is installed but no activation link was found on plugins.php")
	}
	ap, err := w.fetch(ctx, http.MethodGet, w.resolveAdminLink(link), nil, "")
	if err != nil {
		return fmt.Errorf("activation request failed: %w", err)
	}
	if strings.Contains(strings.ToLower(ap.body), "fatal error") {
		return fmt.Errorf("the plugin could not be activated (fatal error on the site): %s", snippet(stripTags(ap.body), 300))
	}
	lp, err := w.fetch(ctx, http.MethodGet, w.adminURL("plugins.php?plugin_status=all"), nil, "")
	if err != nil {
		return err
	}
	if findPluginLink(lp.body, "deactivate") == "" {
		return fmt.Errorf("mvn-migrator did not activate (no deactivate link on plugins.php): %s", snippet(stripTags(ap.body), 300))
	}
	return nil
}

// removePlugin deactivates and deletes the plugin through plugins.php (used when the helper's
// own cleanup could not run). It returns nil when the plugin is no longer listed.
func (w *wpClient) removePlugin(ctx context.Context) error {
	lp, err := w.fetch(ctx, http.MethodGet, w.adminURL("plugins.php?plugin_status=all"), nil, "")
	if err != nil {
		return err
	}
	if !pluginListed(lp.body) {
		return nil
	}
	if link := findPluginLink(lp.body, "deactivate"); link != "" {
		if _, err := w.fetch(ctx, http.MethodGet, w.resolveAdminLink(link), nil, ""); err != nil {
			return fmt.Errorf("deactivate failed: %w", err)
		}
		if lp, err = w.fetch(ctx, http.MethodGet, w.adminURL("plugins.php?plugin_status=all"), nil, ""); err != nil {
			return err
		}
	}
	nonce := findNonce(lp.body, "bulk-action-form")
	if nonce == "" {
		return fmt.Errorf("no bulk-action nonce on plugins.php; delete the mvn-migrator plugin manually")
	}
	form := url.Values{
		"_wpnonce":      {nonce},
		"action":        {"delete-selected"},
		"checked[]":     {pluginFile},
		"plugin_status": {"all"},
		"paged":         {"1"},
		"s":             {""},
		"verify-delete": {"1"},
	}
	if _, err := w.postForm(ctx, w.adminURL("plugins.php?plugin_status=all&paged=1&s="), form); err != nil {
		return fmt.Errorf("delete failed: %w", err)
	}
	if lp, err = w.fetch(ctx, http.MethodGet, w.adminURL("plugins.php?plugin_status=all"), nil, ""); err != nil {
		return err
	}
	if pluginListed(lp.body) {
		return fmt.Errorf("the mvn-migrator plugin is still installed; delete it manually from Plugins")
	}
	return nil
}
