package storage

import (
	"context"
	"database/sql"
)

// Global settings keys. Secrets are stored in app_settings.value_encrypted; plain values in value.
const (
	settingCloudflareToken    = "cloudflare_api_token"     // encrypted
	settingCloudflareEmail    = "cloudflare_account_email" // plain; set => token is a Global API Key
	settingCloudflareTargetIP = "cloudflare_target_ip"     // plain IPv4 fallback
	settingCloudflareTargetV6 = "cloudflare_target_ipv6"   // plain IPv6 fallback (optional)

	// Central outbound-email (SMTP) settings applied to migrated sites via FluentSMTP, plus the
	// SPF/DMARC policy used when ensuring those records in DNS. Only the auth password is a secret.
	settingSMTPHost       = "smtp_host"         // plain: relay/mail host FluentSMTP sends through
	settingSMTPPort       = "smtp_port"         // plain: e.g. 587
	settingSMTPEncryption = "smtp_encryption"   // plain: tls | ssl | none
	settingSMTPAuthUser   = "smtp_auth_user"    // plain: SMTP auth username
	settingSMTPAuthPass   = "smtp_auth_pass"    // encrypted: SMTP auth password (write-only)
	settingSMTPFromName   = "smtp_from_name"    // plain: default From name
	settingSMTPFromEmail  = "smtp_from_email"   // plain: default From email / local-part pattern
	settingSMTPSPFExtra   = "smtp_spf_extra"    // plain: extra SPF term(s), e.g. "include:_spf.example.net"
	settingDMARCPolicy    = "smtp_dmarc_policy" // plain: none | quarantine | reject
	settingDMARCRua       = "smtp_dmarc_rua"    // plain: aggregate-report mailbox for rua=mailto:
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

// SetCloudflareEmail stores the Cloudflare account email. When set, the stored token is used as
// that account's Global API Key (X-Auth-Email + X-Auth-Key) instead of as a Bearer API token.
func (d *Database) SetCloudflareEmail(ctx context.Context, email string) error {
	return d.setPlainSetting(ctx, settingCloudflareEmail, email)
}

// GetCloudflareEmail returns the stored Cloudflare account email ("" => use the token as a Bearer API token).
func (d *Database) GetCloudflareEmail(ctx context.Context) (string, error) {
	return d.getPlainSetting(ctx, settingCloudflareEmail)
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

// ---------------------------------------------------------------------------
// Central email (SMTP + SPF/DMARC) settings
// ---------------------------------------------------------------------------

// SMTPSettings holds the non-secret central outbound-email configuration. The auth password is a
// separate, encrypted, write-only value (see SetSMTPPassword / GetSMTPPassword).
type SMTPSettings struct {
	Host        string `json:"host"`
	Port        string `json:"port"`
	Encryption  string `json:"encryption"` // tls | ssl | none
	AuthUser    string `json:"auth_user"`
	FromName    string `json:"from_name"`
	FromEmail   string `json:"from_email"` // full address, "local@", or bare local-part used per site
	SPFExtra    string `json:"spf_extra"`
	DMARCPolicy string `json:"dmarc_policy"` // none | quarantine | reject
	DMARCRua    string `json:"dmarc_rua"`    // mailbox for aggregate reports (rua=mailto:)
}

// GetSMTPSettings returns the non-secret central email settings (all "" when unset).
func (d *Database) GetSMTPSettings(ctx context.Context) (SMTPSettings, error) {
	var s SMTPSettings
	var err error
	if s.Host, err = d.getPlainSetting(ctx, settingSMTPHost); err != nil {
		return s, err
	}
	if s.Port, err = d.getPlainSetting(ctx, settingSMTPPort); err != nil {
		return s, err
	}
	if s.Encryption, err = d.getPlainSetting(ctx, settingSMTPEncryption); err != nil {
		return s, err
	}
	if s.AuthUser, err = d.getPlainSetting(ctx, settingSMTPAuthUser); err != nil {
		return s, err
	}
	if s.FromName, err = d.getPlainSetting(ctx, settingSMTPFromName); err != nil {
		return s, err
	}
	if s.FromEmail, err = d.getPlainSetting(ctx, settingSMTPFromEmail); err != nil {
		return s, err
	}
	if s.SPFExtra, err = d.getPlainSetting(ctx, settingSMTPSPFExtra); err != nil {
		return s, err
	}
	if s.DMARCPolicy, err = d.getPlainSetting(ctx, settingDMARCPolicy); err != nil {
		return s, err
	}
	if s.DMARCRua, err = d.getPlainSetting(ctx, settingDMARCRua); err != nil {
		return s, err
	}
	return s, nil
}

// SetSMTPSettings stores the non-secret central email settings (an empty field clears that key).
func (d *Database) SetSMTPSettings(ctx context.Context, s SMTPSettings) error {
	pairs := []struct {
		key, val string
	}{
		{settingSMTPHost, s.Host},
		{settingSMTPPort, s.Port},
		{settingSMTPEncryption, s.Encryption},
		{settingSMTPAuthUser, s.AuthUser},
		{settingSMTPFromName, s.FromName},
		{settingSMTPFromEmail, s.FromEmail},
		{settingSMTPSPFExtra, s.SPFExtra},
		{settingDMARCPolicy, s.DMARCPolicy},
		{settingDMARCRua, s.DMARCRua},
	}
	for _, p := range pairs {
		if err := d.setPlainSetting(ctx, p.key, p.val); err != nil {
			return err
		}
	}
	return nil
}

// SetSMTPPassword stores the SMTP auth password, encrypted. Empty clears it.
func (d *Database) SetSMTPPassword(ctx context.Context, password string) error {
	return d.setEncryptedSetting(ctx, settingSMTPAuthPass, password)
}

// GetSMTPPassword decrypts and returns the stored SMTP auth password ("" when unset).
func (d *Database) GetSMTPPassword(ctx context.Context) (string, error) {
	return d.getEncryptedSetting(ctx, settingSMTPAuthPass)
}

// HasSMTPPassword reports whether an SMTP auth password is stored, without decrypting it.
func (d *Database) HasSMTPPassword(ctx context.Context) (bool, error) {
	return d.hasSetting(ctx, settingSMTPAuthPass)
}

// HasSMTPConfigured reports whether central email is usable (a mail host is set).
func (d *Database) HasSMTPConfigured(ctx context.Context) (bool, error) {
	return d.hasSetting(ctx, settingSMTPHost)
}
