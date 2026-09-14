package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// suspendSource suspends the migrated account on the source panel (manual step after the IP switch).
func (h *Handler) suspendSource(c *gin.Context) { h.setSourceSuspended(c, true) }

// unsuspendSource re-enables the account on the source panel.
func (h *Handler) unsuspendSource(c *gin.Context) { h.setSourceSuspended(c, false) }

func (h *Handler) setSourceSuspended(c *gin.Context, suspend bool) {
	result, err := h.engine.SetSourceSuspended(c.Request.Context(), c.Param("id"), suspend)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

// clearMigrations deletes every finished migration (completed, failed, cancelled) with its logs.
func (h *Handler) clearMigrations(c *gin.Context) {
	n, err := h.engine.ClearFinishedMigrations(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": n})
}

// scanDecision receives the operator's choice for malware-scan findings: {"action": "clean"|"skip"|"abort"}.
func (h *Handler) scanDecision(c *gin.Context) {
	var body struct {
		Action string `json:"action"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "action is required"})
		return
	}
	result, err := h.engine.SubmitScanDecision(c.Request.Context(), c.Param("id"), body.Action)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

// repairWordPress re-runs the WordPress registration / PHP / ownership steps for a completed migration.
func (h *Handler) repairWordPress(c *gin.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	result, summary, err := h.engine.RepairWordPress(ctx, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if summary == nil {
		summary = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"migration": result, "summary": summary})
}
