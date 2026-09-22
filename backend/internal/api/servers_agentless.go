package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/migration-tool/backend/internal/panels/agentless"
	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/migration-tool/backend/internal/storage"
)

var knownPanelTypes = map[string]bool{
	string(common.PanelTypeDirectAdmin): true,
	string(common.PanelTypeEnhance):     true,
	string(common.PanelTypeCPanel):      true,
	string(common.PanelTypeFTP):         true,
	string(common.PanelTypeWordPress):   true,
	string(common.PanelTypeCloudways):   true,
}

// defaultPort is the port used when a server request leaves it empty.
func defaultPort(panelType string) int {
	switch common.PanelType(panelType) {
	case common.PanelTypeFTP:
		return 21
	case common.PanelTypeWordPress:
		return 443
	}
	return 22
}

// validateServerRequest checks the fields that the panel type needs. isNew requires the
// password of a new agentless server (an update may leave it empty to keep the stored one).
func validateServerRequest(req *CreateServerRequest, isNew bool) error {
	req.PanelType = strings.ToLower(strings.TrimSpace(req.PanelType))
	if !knownPanelTypes[req.PanelType] {
		return fmt.Errorf("unknown panel type %q (directadmin, enhance, cpanel, cloudways, ftp or wordpress)", req.PanelType)
	}
	if req.AuthMethod == "ssh_key" && req.SSHKeyID == "" {
		return fmt.Errorf("select an SSH key when the authentication method is SSH key")
	}
	if !agentless.IsAgentless(req.PanelType) {
		return nil
	}
	if req.AuthMethod != "password" {
		return fmt.Errorf("%s sources use password authentication", req.PanelType)
	}
	if isNew && req.Password == "" {
		return fmt.Errorf("password is required for a %s source", req.PanelType)
	}
	siteURL := ""
	if v, ok := req.Metadata[agentless.MetaSiteURL]; ok && v != nil {
		siteURL = strings.TrimSpace(fmt.Sprint(v))
	}
	if siteURL != "" {
		u, err := url.Parse(siteURL)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("site_url must be a full URL such as https://example.com")
		}
	} else if req.PanelType == string(common.PanelTypeWordPress) {
		return fmt.Errorf("metadata.site_url (https://example.com) is required for a WordPress source")
	}
	if v, ok := req.Metadata[agentless.MetaFTPS]; ok && v != nil {
		switch v.(type) {
		case bool, string, float64:
		default:
			return fmt.Errorf("metadata.ftps must be true or false")
		}
	}
	return nil
}

// mergeServerMetadata applies the metadata of a request over the stored one. Keys the request
// sends win; keys it does not mention (last_info, enhance_org_id, ...) are kept. When the panel
// type, the host or the site URL of an agentless source changes, the stored probe result is dropped.
func mergeServerMetadata(current json.RawMessage, req *CreateServerRequest, previousHost string, typeChanged bool) json.RawMessage {
	meta := map[string]interface{}{}
	if len(current) > 0 {
		_ = json.Unmarshal(current, &meta)
	}
	oldSite, _ := meta[agentless.MetaSiteURL].(string)
	for k, v := range req.Metadata {
		if v == nil {
			delete(meta, k)
			continue
		}
		meta[k] = v
	}
	if req.EnhanceOrgID != "" {
		meta["enhance_org_id"] = req.EnhanceOrgID
	}
	newSite, _ := meta[agentless.MetaSiteURL].(string)
	if typeChanged || (previousHost != "" && previousHost != req.Host) || strings.TrimSpace(oldSite) != strings.TrimSpace(newSite) {
		delete(meta, agentless.MetaLastInfo)
		delete(meta, agentless.MetaLastInfoAt)
	}
	b, err := json.Marshal(meta)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}

// testAgentlessConnection runs the probe of an FTP/WordPress source and answers
// {success, message, info} as the agentless contract describes.
func (h *Handler) testAgentlessConnection(c *gin.Context, server *storage.Server) {
	password, err := h.db.GetDecryptedPassword(c.Request.Context(), server.ID)
	if err != nil {
		h.logger.Error("Failed to decrypt password", err, nil)
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Minute)
	defer cancel()
	info, err := h.engine.ProbeAgentless(ctx, server, password)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error(), "info": nil})
		return
	}
	message := "Connection successful: " + info.Summary()
	if info.HelperUnreachable {
		message = "Files reachable over FTP; the site does not answer over HTTP, so only what FTP itself could determine is shown below."
	}
	if len(info.Warnings) > 0 {
		message += ". Warning: " + strings.Join(info.Warnings, "; ")
	}
	h.logger.Info("Agentless probe successful", map[string]interface{}{"server_id": server.ID, "summary": info.Summary()})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": message, "info": info.Raw})
}
