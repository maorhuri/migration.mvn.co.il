package api

import (
	"net/http"

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
