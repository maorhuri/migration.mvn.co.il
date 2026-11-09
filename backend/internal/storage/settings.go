package storage

import (
	"context"
	"database/sql"
)

// Global settings keys. Secrets are stored in app_settings.value_encrypted; plain values in value.
const (
	settingCloudflareToken    = "cloudflare_api_token"   // encrypted
	settingCloudflareTargetIP = "cloudflare_target_ip"   // plain IPv4 fallback
	settingCloudflareTargetV6 = "cloudflare_target_ipv6" // plain IPv6 fallback (optional)
)

// setEncryptedSetting stores an encrypted value under key (empty clears it).
func (d *Database) setEncryptedSetting(ctx context.Context, key, plaintext string) error {
	if plaintext == "" {
		_, err := d.db.ExecContext(ctx, "DELETE FROM app_settings WHERE key = $1", key)
		return err
	}
	enc, err := d.encryptor.EncryptString(plaintext)
	if err != nil {
		return err
	}
	_, err = d.db.ExecContext(ctx, `
		INSERT INTO app_settings (key, value_encrypted, updated_at) VALUES ($1, $2, NOW())
		ON CONFLICT (key) DO UPDATE SET value_encrypted = $2, value = NULL, updated_at = NOW()`, key, enc)
	return err
}

// getEncryptedSetting decrypts and returns the value under key ("" when unset).
func (d *Database) getEncryptedSetting(ctx context.Context, key string) (string, error) {
	var enc sql.NullString
	err := d.db.GetContext(ctx, &enc, "SELECT value_encrypted FROM app_settings WHERE key = $1", key)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !enc.Valid || enc.String == "" {
		return "", nil
	}
	return d.encryptor.DecryptString(enc.String)
}

// hasSetting reports whether a (non-empty) value exists under key, without decrypting it.
func (d *Database) hasSetting(ctx context.Context, key string) (bool, error) {
	var n int
	err := d.db.GetContext(ctx, &n,
		"SELECT count(*) FROM app_settings WHERE key = $1 AND (value_encrypted IS NOT NULL AND value_encrypted <> '' OR value IS NOT NULL AND value <> '')", key)
	return n > 0, err
}

// setPlainSetting stores a plaintext value under key (empty clears it).
func (d *Database) setPlainSetting(ctx context.Context, key, value string) error {
	if value == "" {
		_, err := d.db.ExecContext(ctx, "DELETE FROM app_settings WHERE key = $1", key)
		return err
	}
	_, err := d.db.ExecContext(ctx, `
		INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
		ON CONFLICT (key) DO UPDATE SET value = $2, value_encrypted = NULL, updated_at = NOW()`, key, value)
	return err
}

// getPlainSetting returns the plaintext value under key ("" when unset).
func (d *Database) getPlainSetting(ctx context.Context, key string) (string, error) {
	var v sql.NullString
	err := d.db.GetContext(ctx, &v, "SELECT value FROM app_settings WHERE key = $1", key)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !v.Valid {
		return "", nil
	}
	return v.String, nil
}

// ---------------------------------------------------------------------------
// Cloudflare settings (one global token for OUR account, stored encrypted).
// ---------------------------------------------------------------------------

// SetCloudflareToken stores the account-wide Cloudflare API token, encrypted. Empty clears it.
func (d *Database) SetCloudflareToken(ctx context.Context, token string) error {
	return d.setEncryptedSetting(ctx, settingCloudflareToken, token)
}

// GetCloudflareToken decrypts and returns the stored Cloudflare token ("" when unset).
func (d *Database) GetCloudflareToken(ctx context.Context) (string, error) {
	return d.getEncryptedSetting(ctx, settingCloudflareToken)
}

// HasCloudflareToken reports whether a token is stored, without decrypting it.
func (d *Database) HasCloudflareToken(ctx context.Context) (bool, error) {
	return d.hasSetting(ctx, settingCloudflareToken)
}

// SetCloudflareTargetIP stores the fallback target IPv4 used when a migration did not record one.
func (d *Database) SetCloudflareTargetIP(ctx context.Context, ip string) error {
	return d.setPlainSetting(ctx, settingCloudflareTargetIP, ip)
}

// GetCloudflareTargetIP returns the fallback target IPv4 ("" when unset).
func (d *Database) GetCloudflareTargetIP(ctx context.Context) (string, error) {
	return d.getPlainSetting(ctx, settingCloudflareTargetIP)
}

// SetCloudflareTargetIPv6 stores the optional fallback target IPv6 (for AAAA records).
func (d *Database) SetCloudflareTargetIPv6(ctx context.Context, ip string) error {
	return d.setPlainSetting(ctx, settingCloudflareTargetV6, ip)
}

// GetCloudflareTargetIPv6 returns the optional fallback target IPv6 ("" when unset).
func (d *Database) GetCloudflareTargetIPv6(ctx context.Context) (string, error) {
	return d.getPlainSetting(ctx, settingCloudflareTargetV6)
}
