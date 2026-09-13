# Plan: migrating sites without server access (FTP-only / WordPress-admin-only)

Status: proposal, 2026-09-14. Owner: Maor. Nothing here is implemented yet.

## Goal

Migrate a website into Enhance when we do **not** have root/SSH on the source server. Two
credential situations must work:

1. **FTP or SFTP only** (files reachable, no shell, usually no direct MySQL).
2. **WordPress admin login only** (no FTP, no shell).

The site is backed up to a **middle server**, and from there imported into Enhance with the
full pipeline we already have (website creation on the chosen node, rsync, DB import,
wp-config rewrite, WordPress registration, cleanup, PHP config, SSL, permissions, suspend).

## Guiding decision

New **source connectors** only have to produce the same `ExportData` (files directory, DB
dumps, domain list, account facts) that the DirectAdmin exporter produces today. The Enhance
import stays untouched. The migration server itself (`migration.mvn.co.il`, WORK_DIR
`/var/lib/migration-tool/work`, 2 vCPU, 3 GB RAM, 56 GB free) **is** the middle server; it
already stages every DirectAdmin export before importing. No extra server is needed unless
sites exceed roughly 40 GB (then attach a volume or stream directly).

## Source modes

| Mode | Files | Database | Extra facts (PHP version, size, plugins) |
|---|---|---|---|
| FTP/SFTP + helper | FTP mirror (parallel) or SFTP | PHP helper dumps with wp-config credentials | helper `info` |
| WordPress admin only | helper `archive` (tar slices over HTTPS) | helper `db-dump` | helper `info` |
| FTP + WordPress admin (best) | FTP mirror, or helper `archive` when `exec` is allowed (much faster for 100k+ files) | helper `db-dump` | helper `info` |
| FTP + user-supplied DB host/user (remote MySQL open) | FTP | direct `mysqldump`-style dump from the migration server | limited |

Not available in any agentless mode, and reported explicitly as warnings in Review and in
the log: mailboxes and mail contents, cron jobs, FTP users, control-panel DNS zone. DNS is
recovered from **public DNS** instead (see below).

## Components

### 1. Helper: one PHP file, two packagings

`mt-agent.php` (FTP mode, dropped into the docroot under a random name) and the plugin
`mvn-migrator` (WordPress mode, a zip embedded in the Go binary with `go:embed`) share one
core. Endpoints (JSON, `X-MT-Token` header):

- `info`: PHP version and loaded extensions, `exec` availability, WordPress version, table
  prefix, multisite flag, active plugins (flags LiteSpeed Cache, WP Rocket, object cache
  drop-ins), docroot size and file count, DB size, free disk, `max_execution_time`, memory limit.
- `db-dump`: chunked, resumable dump using the wp-config credentials via `mysqli`
  (`SHOW CREATE TABLE`, batched `SELECT` with `LIMIT/OFFSET` by primary key), gzip appended to a
  temp file, each request works ~20 s and returns a cursor; the Go side loops until done.
  Same idea as our DA export: one dump per database, verified table count after import.
- `archive` (WordPress-only mode): tar of the docroot in slices (uses `tar` through `exec`
  when allowed, otherwise `PharData` on directory batches), served with HTTP Range; skips
  cache and backup directories the cleanup step would delete anyway.
- `cleanup`: deletes temp files, the helper file or the plugin, and its option/token.

Security: 32-byte token per migration stored only in the tool DB (encrypted like other
credentials), requests accepted only from the migration server IP, helper expires after 2 h,
random 24-char filename/directory, self-delete on cleanup and on expiry, HTTPS when the site
has it. Every helper call is written to the migration log.

### 2. Go source connectors (backend/internal/panels/ftpsite, wpsite)

Implement the existing `PanelExporter` shape so the engine can treat them like DirectAdmin:

- `Probe(ctx) -> SiteInfo` (used by the "Test & inspect" button and by the size preflight).
- `ExportAccount(ctx, domain, workDir, progress) -> ExportData` with the same progress step
  names the UI already maps ("Exporting databases", "Downloading files", ...).
- FTP: `github.com/jlaffaye/ftp` with FTPS (explicit TLS) and passive mode, N=6 parallel
  connections, resume by size+mtime, exclusion list (`wp-content/cache`, `ai1wm-backups`,
  `updraft`, `*.wpress`, `*.zip` outside uploads, `debug.log`). SFTP: existing `internal/ssh`
  client. Size preflight refuses when docroot size > free staging space minus 5 GB.
- WordPress-only: cookie login (`wp-login.php`), read the upload nonce from
  `plugin-install.php?tab=upload`, POST the embedded zip to `update.php?action=upload-plugin`,
  activate through the nonce link on `plugins.php`, then talk only to the REST routes
  `/wp-json/mvn-migrator/v1/*` with the token. If uploads are blocked
  (`DISALLOW_FILE_MODS`, capability, WAF 403), the wizard shows a manual fallback: "Upload this
  zip in Plugins > Add New, activate, then Continue"; the tool verifies with `info`.
  Application Passwords (WP 5.6+) are accepted for REST but do not replace the one cookie login
  needed to install the plugin.

### 3. Import: unchanged, with derived facts

- Account username is derived from the domain (Enhance assigns the unix user anyway).
- PHP version from `info` (falls back to 8.1 with a warning).
- Databases: the dump(s) produced by the helper, imported by the existing `importDatabase`
  (prefix stripping already handles `user_db` naming), `wp-config.php` rewritten as today.
- DNS: `ExportData.DNS` is filled from public DNS instead of the panel zone. Query A/AAAA/MX/
  TXT/CNAME/SRV for apex, `www`, `mail`, `webmail`, `ftp`, `autoconfig`, `autodiscover`,
  `_dmarc`, `default._domainkey`, `google._domainkey`, `_acme-challenge`, and every hostname
  found in the WordPress site URL and `wp-config.php`. Shown in Review; a later phase pushes
  them into the Enhance zone.
- Steps that need panel data (emails, cron) log a single explicit warning each and are
  skipped; the warning count stays honest.

### 4. UI

- New Migration, step 1 "Source": three cards: **Control panel server** (today's flow),
  **FTP / SFTP**, **WordPress login**. The agentless forms take domain, credentials, optional
  DB host/user/password, and a **Test & inspect** button that runs `Probe` and shows a result
  card (WordPress version, PHP version, size, DB size, plugin flags, `exec` available, warnings
  such as "LiteSpeed Cache active: will be deactivated on Nginx").
- Agentless sources are saved as server records with `panel_type = ftp | wordpress`
  (credentials encrypted as today, extra facts in metadata) so they appear in Servers with a
  distinct badge and can be reused.
- Review step lists what will not be migrated and the staging-space check.
- Everything after Target is the existing wizard, including the hosts line, warnings, and the
  Suspend action (not applicable to agentless sources: the button is hidden and a "disable the
  old site manually" checklist item replaces it).

## Phases and estimates

| Phase | Scope | Estimate |
|---|---|---|
| 1 | FTP/SFTP connector, helper file with `info` + `db-dump` + `cleanup`, size preflight, wizard source cards, Test & inspect, import reuse | 2 to 3 working days |
| 2 | WordPress-admin-only: plugin packaging, cookie login + auto install, `archive` endpoint with slices, manual-upload fallback | 1.5 to 2 days |
| 3 | Public-DNS capture shown in Review and pushed to the Enhance zone; post-import verification (HTTP check against the node with the Host header); LiteSpeed Cache deactivation and permalink flush | 1 to 2 days |

Recommended order: 1, then 3, then 2. Phase 1 covers most cases (almost every host gives
FTP) with the least risk to customer sites; phase 3 removes the manual verification work
before Suspend; phase 2 is for the hosts that hand out nothing but a WordPress login.

## Risks and how the plan handles them

- **PHP limits** (`max_execution_time`, memory): every helper call works in 20 s slices and
  returns a cursor; nothing depends on one long request.
- **WAF / mod_security** blocking the helper: detected as 403/406 with a clear message and
  the advice to whitelist the migration server IP; FTP path still works for files.
- **Large sites**: parallel FTP, `archive` via `tar` when `exec` exists, staging-space
  preflight, cleanup after import; above ~40 GB add a volume to the migration server.
- **Non-WordPress sites**: FTP mode works for files; the DB needs user-supplied credentials
  (the helper can still dump when given host/user/password).
- **Multisite**: detected by `info` and refused in phase 1 with an explicit message.
- **Customer-site footprint**: the helper is time-limited, self-deleting and logged; the
  plugin is removed at cleanup. Nothing else on the source is modified.
- **Credentials**: stored encrypted with the existing mechanism, never written to logs.

## Decisions needed

1. Order of phases (recommendation above).
2. Is installing the helper plugin on a customer's WordPress automatically acceptable, or
   should it always be a manual upload by the operator?
3. Staging capacity: keep the current 56 GB on the migration server or attach a volume now.
