package agentless

import (
	"archive/zip"
	"bytes"
	"embed"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// The helper and the plugin wrapper are maintained separately (see docs/agentless-protocol.md);
// the Go side only bakes the configuration in and packages them.
//
//go:embed assets/mvn-agent.php assets/plugin/mvn-migrator.php
var assets embed.FS

const (
	agentAssetPath   = "assets/mvn-agent.php"           // repo path only, never exposed externally
	pluginAssetPath  = "assets/plugin/mvn-migrator.php" // repo path only, never exposed externally
	pluginSlug       = "mig-helper"
	pluginFile       = "mig-helper/mig-helper.php" // plugin basename as WordPress reports it
	pluginAjaxAction = "mig_helper"
)

// helperConfig is what gets baked into the helper by placeholder replacement.
type helperConfig struct {
	Token     string    // 32 hex chars
	AllowedIP string    // empty = any
	Expires   time.Time // token expiry
	Docroot   string    // empty = dirname(__FILE__) (FTP mode) / ABSPATH (plugin mode)
}

// replacePlaceholders bakes the configuration into helper source code.
func replacePlaceholders(src []byte, cfg helperConfig) []byte {
	r := strings.NewReplacer(
		"__TOKEN__", cfg.Token,
		"__ALLOWED_IP__", cfg.AllowedIP,
		"__EXPIRES__", strconv.FormatInt(cfg.Expires.Unix(), 10),
		"__DOCROOT__", cfg.Docroot,
	)
	return []byte(r.Replace(string(src)))
}

// renderAgent returns the helper file ready for upload.
func renderAgent(cfg helperConfig) ([]byte, error) {
	src, err := assets.ReadFile(agentAssetPath)
	if err != nil {
		return nil, fmt.Errorf("embedded helper missing: %w", err)
	}
	return replacePlaceholders(src, cfg), nil
}

// BuildPluginZip packages the helper as a generically named WordPress plugin with the given
// token (the plugin slug/filenames deliberately carry no identifying company name).
// It is used for the wp-admin upload and can later be served to operators for manual installs.
func BuildPluginZip(token, allowedIP string, expires time.Time) ([]byte, error) {
	return buildPluginZip(helperConfig{Token: token, AllowedIP: allowedIP, Expires: expires})
}

func buildPluginZip(cfg helperConfig) ([]byte, error) {
	wrapper, err := assets.ReadFile(pluginAssetPath)
	if err != nil {
		return nil, fmt.Errorf("embedded plugin wrapper missing: %w", err)
	}
	agent, err := assets.ReadFile(agentAssetPath)
	if err != nil {
		return nil, fmt.Errorf("embedded helper missing: %w", err)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	now := time.Now()
	add := func(name string, data []byte) error {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: now})
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	}
	if err := add(pluginSlug+"/mig-helper.php", replacePlaceholders(wrapper, cfg)); err != nil {
		return nil, err
	}
	if err := add(pluginSlug+"/mig-agent.php", replacePlaceholders(agent, cfg)); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
