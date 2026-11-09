package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// CloudflareSettingsResponse is what GET /settings/cloudflare returns. It NEVER contains the
// token itself: only whether one is stored, and the (non-secret) fallback target IPs.
type CloudflareSettingsResponse struct {
	Configured bool   `json:"configured"`
	TargetIP   string `json:"target_ip"`
	TargetIPv6 string `json:"target_ipv6"`
}

// getCloudflareSettings reports whether a Cloudflare token is configured (never the token).
func (h *Handler) getCloudflareSettings(c *gin.Context) {
	ctx := c.Request.Context()
	configured, err := h.db.HasCloudflareToken(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	targetIP, _ := h.db.GetCloudflareTargetIP(ctx)
	targetIPv6, _ := h.db.GetCloudflareTargetIPv6(ctx)
	c.JSON(http.StatusOK, CloudflareSettingsResponse{Configured: configured, TargetIP: targetIP, TargetIPv6: targetIPv6})
}

// UpdateCloudflareSettingsRequest is the body of PUT /settings/cloudflare. The token is
// write-only: send a new value to set it, omit it to leave the stored one untouched, or set
// clear=true to remove it. target_ip / target_ipv6 are always replaced by what is sent (an empty
// string clears them).
type UpdateCloudflareSettingsRequest struct {
	APIToken   *string `json:"api_token,omitempty"`
	TargetIP   *string `json:"target_ip,omitempty"`
	TargetIPv6 *string `json:"target_ipv6,omitempty"`
	Clear      bool    `json:"clear,omitempty"`
}

// updateCloudflareSettings stores the account-wide Cloudflare token (encrypted) and the optional
// fallback target IP(s). It never echoes the token back.
func (h *Handler) updateCloudflareSettings(c *gin.Context) {
	ctx := c.Request.Context()
	var req UpdateCloudflareSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	switch {
	case req.Clear:
		if err := h.db.SetCloudflareToken(ctx, ""); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	case req.APIToken != nil && strings.TrimSpace(*req.APIToken) != "":
		if err := h.db.SetCloudflareToken(ctx, strings.TrimSpace(*req.APIToken)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	if req.TargetIP != nil {
		if err := h.db.SetCloudflareTargetIP(ctx, strings.TrimSpace(*req.TargetIP)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	if req.TargetIPv6 != nil {
		if err := h.db.SetCloudflareTargetIPv6(ctx, strings.TrimSpace(*req.TargetIPv6)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	h.getCloudflareSettings(c)
}
