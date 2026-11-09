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
	Email      string `json:"email"` // when set, the stored token is used as a Global API Key
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
	email, _ := h.db.GetCloudflareEmail(ctx)
	targetIP, _ := h.db.GetCloudflareTargetIP(ctx)
	targetIPv6, _ := h.db.GetCloudflareTargetIPv6(ctx)
	c.JSON(http.StatusOK, CloudflareSettingsResponse{Configured: configured, Email: email, TargetIP: targetIP, TargetIPv6: targetIPv6})
}

// UpdateCloudflareSettingsRequest is the body of PUT /settings/cloudflare. The token is
// write-only: send a new value to set it, omit it to leave the stored one untouched, or set
// clear=true to remove it. target_ip / target_ipv6 are always replaced by what is sent (an empty
// string clears them).
type UpdateCloudflareSettingsRequest struct {
	APIToken   *string `json:"api_token,omitempty"`
	Email      *string `json:"email,omitempty"` // set to use the token as a Global API Key; empty string = API token
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
		if err := h.db.SetCloudflareEmail(ctx, ""); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	case req.APIToken != nil && strings.TrimSpace(*req.APIToken) != "":
		if err := h.db.SetCloudflareToken(ctx, strings.TrimSpace(*req.APIToken)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	// Email set (non-empty) => use the token as that account's Global API Key; empty => API token (Bearer).
	if req.Email != nil {
		if err := h.db.SetCloudflareEmail(ctx, strings.TrimSpace(*req.Email)); err != nil {
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

// ---------------------------------------------------------------------------
// Central email (SMTP + SPF/DMARC) settings
// ---------------------------------------------------------------------------

// EmailSettingsResponse is what GET /settings/email returns. It NEVER contains the SMTP password:
// only whether one is stored (PasswordConfigured) plus the non-secret fields.
type EmailSettingsResponse struct {
	Configured         bool   `json:"configured"` // a mail host is set (central email usable)
	PasswordConfigured bool   `json:"password_configured"`
	Host               string `json:"host"`
	Port               string `json:"port"`
	Encryption         string `json:"encryption"`
	AuthUser           string `json:"auth_user"`
	FromName           string `json:"from_name"`
	FromEmail          string `json:"from_email"`
	SPFExtra           string `json:"spf_extra"`
	DMARCPolicy        string `json:"dmarc_policy"`
	DMARCRua           string `json:"dmarc_rua"`
}

// getEmailSettings returns the non-secret central email settings (never the SMTP password).
func (h *Handler) getEmailSettings(c *gin.Context) {
	ctx := c.Request.Context()
	s, err := h.db.GetSMTPSettings(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	hasPass, _ := h.db.HasSMTPPassword(ctx)
	c.JSON(http.StatusOK, EmailSettingsResponse{
		Configured:         strings.TrimSpace(s.Host) != "",
		PasswordConfigured: hasPass,
		Host:               s.Host,
		Port:               s.Port,
		Encryption:         s.Encryption,
		AuthUser:           s.AuthUser,
		FromName:           s.FromName,
		FromEmail:          s.FromEmail,
		SPFExtra:           s.SPFExtra,
		DMARCPolicy:        s.DMARCPolicy,
		DMARCRua:           s.DMARCRua,
	})
}

// UpdateEmailSettingsRequest is the body of PUT /settings/email. The password is write-only: send
// a new value to set it, omit it to leave the stored one untouched, or set clear_password=true to
// remove it. The non-secret fields are always replaced by what is sent.
type UpdateEmailSettingsRequest struct {
	Host          *string `json:"host,omitempty"`
	Port          *string `json:"port,omitempty"`
	Encryption    *string `json:"encryption,omitempty"`
	AuthUser      *string `json:"auth_user,omitempty"`
	AuthPassword  *string `json:"auth_password,omitempty"`
	FromName      *string `json:"from_name,omitempty"`
	FromEmail     *string `json:"from_email,omitempty"`
	SPFExtra      *string `json:"spf_extra,omitempty"`
	DMARCPolicy   *string `json:"dmarc_policy,omitempty"`
	DMARCRua      *string `json:"dmarc_rua,omitempty"`
	ClearPassword bool    `json:"clear_password,omitempty"`
}

// updateEmailSettings stores the central email settings. The SMTP password is encrypted and never
// echoed back; the other fields are stored in plaintext.
func (h *Handler) updateEmailSettings(c *gin.Context) {
	ctx := c.Request.Context()
	var req UpdateEmailSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Start from the stored values so omitted fields are left untouched.
	s, err := h.db.GetSMTPSettings(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	setIf := func(dst *string, v *string) {
		if v != nil {
			*dst = strings.TrimSpace(*v)
		}
	}
	setIf(&s.Host, req.Host)
	setIf(&s.Port, req.Port)
	setIf(&s.Encryption, req.Encryption)
	setIf(&s.AuthUser, req.AuthUser)
	setIf(&s.FromName, req.FromName)
	setIf(&s.FromEmail, req.FromEmail)
	setIf(&s.SPFExtra, req.SPFExtra)
	setIf(&s.DMARCPolicy, req.DMARCPolicy)
	setIf(&s.DMARCRua, req.DMARCRua)
	if err := h.db.SetSMTPSettings(ctx, s); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	switch {
	case req.ClearPassword:
		if err := h.db.SetSMTPPassword(ctx, ""); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	case req.AuthPassword != nil && strings.TrimSpace(*req.AuthPassword) != "":
		if err := h.db.SetSMTPPassword(ctx, strings.TrimSpace(*req.AuthPassword)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	h.getEmailSettings(c)
}
