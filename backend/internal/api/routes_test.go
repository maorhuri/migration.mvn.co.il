package api

import (
	"testing"

	"github.com/gin-gonic/gin"
)

// TestSetupRoutesNoPanic guards the route tree: gin registers routes at setup time and panics on a
// conflict (e.g. mixing a static segment and a param at the same level). The consolidated batch
// endpoint adds a static "/batches/:batch_id" alongside the "/:id" param route, so register the
// whole tree once and make sure it builds. SetupRoutes only wires handlers; it never calls them,
// so a Handler with nil dependencies is enough here.
func TestSetupRoutesNoPanic(t *testing.T) {
	gin.SetMode(gin.TestMode)
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("SetupRoutes panicked (route conflict?): %v", r)
		}
	}()
	(&Handler{}).SetupRoutes(gin.New())
}
