package migration

import (
	"context"
	"fmt"
	"time"

	"github.com/migration-tool/backend/internal/panels/agentless"
	"github.com/migration-tool/backend/internal/storage"
)

// ProbeAgentless installs the helper on an FTP/WordPress source, reads its `info` and removes
// it again; the result is stored in the server metadata (last_info) for the accounts list.
func (e *Engine) ProbeAgentless(ctx context.Context, server *storage.Server, password string) (*agentless.Info, error) {
	return e.agentlessInfo(ctx, server, password, true)
}

// agentlessInfo returns the probe result of an agentless source: the stored one when fresh is
// false and a previous probe exists, otherwise a live probe (stored afterwards).
func (e *Engine) agentlessInfo(ctx context.Context, server *storage.Server, password string, fresh bool) (*agentless.Info, error) {
	if !fresh {
		if info, _, ok := agentless.LastInfo(server); ok {
			return info, nil
		}
	}
	if password == "" {
		password, _ = e.db.GetServerPassword(ctx, server.ID)
	}
	logFn := func(level, message string) {
		fields := map[string]interface{}{"server_id": server.ID, "server": server.Name}
		switch level {
		case "warn":
			e.logger.Warn("[agentless] "+message, fields)
		case "error":
			e.logger.Error("[agentless] "+message, nil, fields)
		default:
			e.logger.Info("[agentless] "+message, fields)
		}
	}
	info, err := agentless.Probe(ctx, server, password, logFn)
	if err != nil {
		return nil, err
	}
	server.Metadata = agentless.MetadataWithInfo(server.Metadata, info, time.Now())
	if err := e.db.SetServerMetadata(ctx, server.ID, server.Metadata); err != nil {
		e.logger.Warn("could not store the probe result", map[string]interface{}{"server_id": server.ID, "error": err.Error()})
	}
	return info, nil
}

// agentlessAccount builds the single account an agentless source exposes.
func agentlessAccount(server *storage.Server, info *agentless.Info) (AccountInfo, error) {
	cfg, err := agentless.ConfigFromServer(server, "-")
	if err != nil {
		return AccountInfo{}, err
	}
	host := cfg.SiteHost()
	acc := AccountInfo{
		Username:      agentless.Slug(host),
		Domain:        host,
		DiskLimit:     "Unlimited",
		EmailAccounts: []string{},
		Suspended:     false,
	}
	if info != nil {
		acc.IsWordPress = bool(info.WordPress)
		acc.PHPVersion = info.PHPMajorMinor()
		acc.DiskUsed = info.DiskUsed()
		acc.Databases = info.Databases()
	}
	if cfg.DBName != "" && len(acc.Databases) == 0 {
		acc.Databases = []string{cfg.DBName}
	}
	if acc.Databases == nil {
		acc.Databases = []string{}
	}
	return acc, nil
}

// agentlessAccounts returns the single account of an agentless source (cached probe or live probe).
func (e *Engine) agentlessAccounts(ctx context.Context, server *storage.Server, password string) ([]AccountInfo, error) {
	info, err := e.agentlessInfo(ctx, server, password, false)
	if err != nil {
		return nil, fmt.Errorf("could not read the site: %w", err)
	}
	acc, err := agentlessAccount(server, info)
	if err != nil {
		return nil, err
	}
	return []AccountInfo{acc}, nil
}
