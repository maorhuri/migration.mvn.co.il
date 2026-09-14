package agentless

import (
	"context"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
)

// session is an installed helper: the HTTP client to talk to it and how to remove it again.
type session struct {
	cfg    *Config
	helper *helper
	info   *Info

	// FTP mode
	ftp        *ftpConn
	ftpDocroot string
	helperPath string // remote path of the uploaded helper
	helperName string

	// WordPress mode
	wp *wpClient

	closed bool
}

// open installs the helper and runs `info`.
func open(ctx context.Context, cfg *Config, logFn LogFunc) (*session, error) {
	switch cfg.Mode {
	case common.PanelTypeFTP:
		return openFTP(ctx, cfg, logFn)
	case common.PanelTypeWordPress:
		return openWordPress(ctx, cfg, logFn)
	}
	return nil, fmt.Errorf("unsupported agentless mode %q", cfg.Mode)
}

// ftpPrepare connects over FTP and resolves the docroot (shared by open and the fallback).
func ftpPrepare(ctx context.Context, cfg *Config, logFn LogFunc) (*ftpConn, string, bool, error) {
	conn, err := ftpDial(ctx, cfg, logFn)
	if err != nil {
		return nil, "", false, err
	}
	logFn("info", fmt.Sprintf("FTP login OK on %s:%d as %s (directory %s)", cfg.Host, cfg.Port, cfg.Username, conn.cwd))
	if cfg.Docroot != "" {
		dir := path.Clean("/" + strings.TrimPrefix(cfg.Docroot, "/"))
		isWP, err := conn.verifyDir(dir)
		if err != nil {
			conn.close()
			return nil, "", false, err
		}
		logFn("info", fmt.Sprintf("Using configured docroot %s (wp-config.php: %v)", dir, isWP))
		return conn, dir, isWP, nil
	}
	dir, isWP, checked, err := conn.findDocroot(ctx, cfg.SiteHost())
	if err != nil {
		conn.close()
		return nil, "", false, err
	}
	logFn("info", fmt.Sprintf("Docroot found at %s (wp-config.php: %v; looked in %d directories)", dir, isWP, len(checked)))
	return conn, dir, isWP, nil
}

func openFTP(ctx context.Context, cfg *Config, logFn LogFunc) (*session, error) {
	conn, docroot, _, err := ftpPrepare(ctx, cfg, logFn)
	if err != nil {
		return nil, err
	}
	sess := &session{cfg: cfg, ftp: conn, ftpDocroot: docroot}
	hc := helperConfig{Token: randHex(32), AllowedIP: publicIP(ctx), Expires: time.Now().Add(tokenTTL)}
	sess.helperName = "mig-" + randHex(12) + ".php"
	sess.helperPath = path.Join(docroot, sess.helperName)

	data, err := renderAgent(hc)
	if err != nil {
		conn.close()
		return nil, err
	}
	if err := conn.upload(sess.helperPath, data); err != nil {
		conn.close()
		return nil, err
	}
	logFn("info", fmt.Sprintf("Helper uploaded to %s (%d bytes, allowed IP %q, valid %s)", sess.helperPath, len(data), hc.AllowedIP, tokenTTL))

	remove := func() {
		if err := conn.deleteFile(sess.helperPath); err != nil {
			logFn("warn", fmt.Sprintf("Could not delete %s over FTP: %v; remove it manually", sess.helperPath, err))
		} else {
			logFn("info", fmt.Sprintf("Helper %s removed over FTP", sess.helperPath))
		}
	}

	var reasons []string // every candidate's failure, in order tried: the real site_url first, the FTP host as fallback (usually less useful, but kept so nothing is hidden)
	for _, base := range cfg.siteURLCandidates() {
		h := newHelper(base+"/"+sess.helperName, false, hc.Token, logFn)
		raw, err := h.call(ctx, "info", nil)
		var forb *ForbiddenError
		if errors.As(err, &forb) && hc.AllowedIP != "" {
			logFn("warn", fmt.Sprintf("The helper sees a different client address than %s (%s); re-uploading it without an IP restriction", hc.AllowedIP, forb.Message))
			hc.AllowedIP = ""
			if data, err = renderAgent(hc); err == nil {
				if err = conn.upload(sess.helperPath, data); err == nil {
					raw, err = h.call(ctx, "info", nil)
				}
			}
		}
		if err == nil {
			info, perr := parseInfo(raw)
			if perr != nil {
				remove()
				conn.close()
				return nil, perr
			}
			sess.helper, sess.info = h, info
			logFn("info", fmt.Sprintf("Helper answers at %s: %s", h.base, info.Summary()))
			return sess, nil
		}
		var un *UnreachableError
		if errors.As(err, &un) {
			logFn("warn", err.Error())
			reasons = append(reasons, err.Error())
			continue
		}
		if ctx.Err() != nil {
			remove()
			conn.close()
			return nil, ctx.Err()
		}
		remove()
		conn.close()
		return nil, err
	}
	remove()
	conn.close()
	if len(reasons) == 0 {
		reasons = []string{"no site URL to try"}
	}
	return nil, &UnreachableError{URL: cfg.SiteURL, Reason: strings.Join(reasons, "; then tried: ")}
}

func openWordPress(ctx context.Context, cfg *Config, logFn LogFunc) (*session, error) {
	wp, err := newWPClient(cfg.SiteURL, cfg.Username, cfg.Password, logFn)
	if err != nil {
		return nil, err
	}
	if err := wp.login(ctx); err != nil {
		return nil, err
	}
	logFn("info", fmt.Sprintf("wp-admin login OK on %s as %s", cfg.SiteURL, cfg.Username))

	hc := helperConfig{Token: randHex(32), AllowedIP: publicIP(ctx), Expires: time.Now().Add(tokenTTL)}
	zipData, err := buildPluginZip(hc)
	if err != nil {
		return nil, err
	}
	zipPath := "/api/v1/servers/<server id>/" + pluginSlug + ".zip"
	if err := wp.installPlugin(ctx, zipData, zipPath); err != nil {
		return nil, err
	}
	logFn("info", "migration helper plugin installed and activated")

	sess := &session{cfg: cfg, wp: wp}
	h := newHelper(wp.siteURL+"/wp-admin/admin-ajax.php", true, hc.Token, logFn)
	// own client (no overall timeout: downloads can be long) sharing the login cookies
	h.insecure = wp.insecure
	h.client = newHTTPClient(wp.insecure, wp.client.Jar)
	raw, err := h.call(ctx, "info", nil)
	var forb *ForbiddenError
	if errors.As(err, &forb) && hc.AllowedIP != "" {
		logFn("warn", fmt.Sprintf("The plugin sees a different client address than %s (%s); reinstalling it without an IP restriction", hc.AllowedIP, forb.Message))
		hc.AllowedIP = ""
		if zipData, err = buildPluginZip(hc); err == nil {
			if err = wp.installPlugin(ctx, zipData, zipPath); err == nil {
				raw, err = h.call(ctx, "info", nil)
			}
		}
	}
	if err != nil {
		if rerr := wp.removePlugin(context.Background()); rerr != nil {
			logFn("warn", "Plugin removal after a failed probe: "+rerr.Error())
		}
		return nil, err
	}
	info, err := parseInfo(raw)
	if err != nil {
		wp.removePlugin(context.Background())
		return nil, err
	}
	sess.helper, sess.info = h, info
	logFn("info", "Plugin endpoint answers: "+info.Summary())
	return sess, nil
}

// close runs the helper's cleanup and removes what is left of it. Safe to call twice.
func (s *session) close(ctx context.Context) error {
	if s == nil || s.closed {
		return nil
	}
	s.closed = true
	logFn := s.helper.logFn
	if ctx.Err() != nil {
		ctx = context.Background()
	}
	cctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	var errs []string
	if _, err := s.helper.call(cctx, "cleanup", nil); err != nil {
		errs = append(errs, "cleanup call: "+err.Error())
	}
	switch s.cfg.Mode {
	case common.PanelTypeFTP:
		if s.ftp != nil {
			if err := s.ftp.deleteFile(s.helperPath); err != nil {
				errs = append(errs, fmt.Sprintf("delete %s: %v", s.helperPath, err))
			}
			if len(errs) > 0 && s.info != nil && s.info.TmpDir != "" {
				// the helper could not clean up itself: remove its temp dir by name under the docroot
				tmp := path.Join(s.ftpDocroot, path.Base(s.info.TmpDir))
				if err := s.ftp.removeDir(tmp); err != nil {
					errs = append(errs, fmt.Sprintf("remove %s: %v", tmp, err))
				} else {
					logFn("info", "Temp directory "+tmp+" removed over FTP")
				}
			}
			s.ftp.close()
		}
	case common.PanelTypeWordPress:
		if s.wp != nil {
			if err := s.wp.removePlugin(cctx); err != nil {
				errs = append(errs, err.Error())
			}
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	logFn("info", "Helper removed from the source")
	return nil
}
