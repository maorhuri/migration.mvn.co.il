package agentless

import (
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

var (
	publicIPMu     sync.Mutex
	publicIPCached string
	publicIPAt     time.Time
)

// publicIP returns the address the migration server appears from, when it can be learned
// cheaply: the PUBLIC_IP environment variable, the outbound interface when it carries a public
// address, else a 3-second lookup. Empty means "unknown" (the helper then accepts any IP).
func publicIP(ctx context.Context) string {
	if v := strings.TrimSpace(os.Getenv("PUBLIC_IP")); v != "" {
		return v
	}
	publicIPMu.Lock()
	defer publicIPMu.Unlock()
	if publicIPCached != "" && time.Since(publicIPAt) < 10*time.Minute {
		return publicIPCached
	}
	ip := outboundIP()
	if ip == "" {
		ip = lookupPublicIP(ctx)
	}
	if ip != "" {
		publicIPCached, publicIPAt = ip, time.Now()
	}
	return ip
}

func outboundIP() string {
	conn, err := net.DialTimeout("udp", "1.1.1.1:53", 2*time.Second)
	if err != nil {
		return ""
	}
	defer conn.Close()
	addr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok || addr.IP == nil || addr.IP.To4() == nil {
		return "" // IPv6 egress: the site may see a different address; do not pin
	}
	if addr.IP.IsPrivate() || addr.IP.IsLoopback() || addr.IP.IsLinkLocalUnicast() || addr.IP.IsUnspecified() {
		return ""
	}
	return addr.IP.String()
}

func lookupPublicIP(ctx context.Context) string {
	lctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	for _, u := range []string{"https://checkip.amazonaws.com", "https://api.ipify.org"} {
		req, err := http.NewRequestWithContext(lctx, http.MethodGet, u, nil)
		if err != nil {
			continue
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
		resp.Body.Close()
		if ip := net.ParseIP(strings.TrimSpace(string(body))); ip != nil && ip.To4() != nil {
			return ip.String()
		}
	}
	return ""
}
