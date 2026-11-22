package migration

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/panels/enhance"
)

// TargetDomainStatus describes, for one domain, the website that already exists for it on the target
// Enhance cluster: which node it sits on, its status, and whether that node actually serves the site
// (a live fetch straight to the node, bypassing DNS/Cloudflare) -- so staff reviewing the "already on
// target" accounts can tell a genuinely live site from a stale/placeholder website object.
type TargetDomainStatus struct {
	Domain        string `json:"domain"`
	OnTarget      bool   `json:"on_target"`
	AppServerID   string `json:"app_server_id,omitempty"`
	AppServerName string `json:"app_server_name,omitempty"`
	WebsiteID     string `json:"website_id,omitempty"`
	WebsiteStatus string `json:"website_status,omitempty"`
	NodeIP        string `json:"node_ip,omitempty"`
	HTTPCode      int    `json:"http_code,omitempty"`
	ServesFromNode bool  `json:"serves_from_node"`
}

// TargetStatusResult maps each requested domain to its status on the target.
type TargetStatusResult struct {
	Results map[string]TargetDomainStatus `json:"results"`
}

// TargetDomainStatuses looks up each domain on the target Enhance cluster and, for those that exist,
// reports the node it is on and whether that node actually serves it. Only meaningful for an Enhance
// target; other targets return an empty result. Live checks run concurrently under a bounded pool
// and an overall timeout; any single failure just leaves serves_from_node false.
func (e *Engine) TargetDomainStatuses(ctx context.Context, targetServerID string, domains []string) (*TargetStatusResult, error) {
	server, err := e.db.GetServer(ctx, targetServerID)
	if err != nil {
		return nil, fmt.Errorf("target server not found: %w", err)
	}
	out := &TargetStatusResult{Results: map[string]TargetDomainStatus{}}
	if common.PanelType(server.PanelType) != common.PanelTypeEnhance {
		return out, nil
	}

	apiKey, _ := e.db.GetServerAPIKey(ctx, server.ID)
	en := enhance.New()
	if err := en.ConnectAPI(ctx, e.db.ToConnectionConfig(server), apiKey); err != nil {
		return nil, fmt.Errorf("failed to connect to Enhance: %w", err)
	}
	sites, err := en.ListWebsites(ctx, "")
	if err != nil {
		return nil, err
	}

	// node id -> IP (appServerId equals the cluster server id, which createWebsite sets as appServerId).
	nodeIP := map[string]string{}
	if cluster, cerr := e.GetEnhanceClusterServers(ctx, server, apiKey); cerr == nil {
		for _, c := range cluster {
			nodeIP[c.ID] = c.IP
		}
	}

	// domain -> the website that holds it (primary or alias).
	type wsInfo struct{ appID, appName, id, status string }
	byDomain := map[string]wsInfo{}
	for _, ws := range sites {
		info := wsInfo{ws.AppServerID, ws.AppServerName, ws.ID, ws.Status}
		if d := normalizeDomain(ws.Domain.Domain); d != "" {
			byDomain[d] = info
		}
		for _, a := range ws.Aliases {
			if d := normalizeDomain(a.Domain); d != "" {
				byDomain[d] = info
			}
		}
	}

	// Unique requested domains.
	seen := map[string]bool{}
	var list []string
	for _, d := range domains {
		if d = normalizeDomain(d); d != "" && !seen[d] {
			seen[d] = true
			list = append(list, d)
		}
	}

	cctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	type res struct {
		domain string
		st     TargetDomainStatus
	}
	ch := make(chan res, len(list))
	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	for _, d := range list {
		st := TargetDomainStatus{Domain: d}
		if info, ok := byDomain[d]; ok {
			st.OnTarget = true
			st.AppServerID = info.appID
			st.AppServerName = info.appName
			st.WebsiteID = info.id
			st.WebsiteStatus = info.status
			st.NodeIP = nodeIP[info.appID]
		}
		if !st.OnTarget || st.NodeIP == "" {
			out.Results[d] = st // nothing to probe
			continue
		}
		wg.Add(1)
		go func(d, ip string, st TargetDomainStatus) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			st.HTTPCode, st.ServesFromNode = serveCheckViaIP(cctx, d, ip)
			ch <- res{d, st}
		}(d, st.NodeIP, st)
	}
	go func() { wg.Wait(); close(ch) }()
	for r := range ch {
		out.Results[r.domain] = r.st
	}
	return out, nil
}

// serveCheckViaIP fetches https://domain/ forcing the connection to ip (bypassing DNS/Cloudflare), so
// it answers "does THIS node actually serve the site?". Returns the HTTP status and whether it is a
// real response (2xx/3xx). TLS verification is skipped: the node may answer on a cert that does not
// match, which still proves it serves the site.
func serveCheckViaIP(ctx context.Context, domain, ip string) (int, bool) {
	if ip == "" {
		return 0, false
	}
	dialer := &net.Dialer{Timeout: 7 * time.Second}
	tr := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			_, port, err := net.SplitHostPort(addr)
			if err != nil {
				port = "443"
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ip, port))
		},
		TLSClientConfig:   &tls.Config{InsecureSkipVerify: true},
		DisableKeepAlives: true,
	}
	client := &http.Client{
		Transport: tr,
		Timeout:   10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://"+domain+"/", nil)
	if err != nil {
		return 0, false
	}
	req.Header.Set("User-Agent", "migration-tool/serve-check")
	resp, err := client.Do(req)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 2048))
	return resp.StatusCode, resp.StatusCode >= 200 && resp.StatusCode < 400
}
