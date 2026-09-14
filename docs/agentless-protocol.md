# Agentless sources: helper protocol and API contract (phase 1 build, 2026-09-14)

Three parts are built in parallel from this contract. Do not change the contract; extend the
docs if you must add something, and say so in your report.

## 1. Helper file `mvn-agent.php` (repo name; uploaded under a random generic name, see below)

Location in the repo: `backend/internal/panels/agentless/assets/mvn-agent.php` (embedded into
the Go binary with `//go:embed`). One file, PHP >= 7.2, no dependencies, must run under
`max_execution_time=30` and `memory_limit=128M`.

Configuration is baked in at upload time by literal string replacement of placeholders:
`__TOKEN__` (32 hex chars), `__ALLOWED_IP__` (empty = any), `__EXPIRES__` (unix timestamp),
`__DOCROOT__` (empty = `dirname(__FILE__)`).

Invocation:
- HTTP: `<site_url>/<random-name>.php?action=<a>&token=<t>[&k=v]`; the token is also accepted
  in the `X-MT-Token` header. Responses are JSON: `{"ok":true,...}` or `{"ok":false,"error":"..."}`
  (HTTP 200), except a bad/expired token (403) and a missing file (404). No HTML, no warnings in
  the output (`ini_set('display_errors',0)`, output buffering).
- CLI (tests): `php mvn-agent.php <action> key=value ...`; `MIG_DOCROOT` env overrides the docroot.

Uploaded/deployed name: the helper is written to the target under a random generic name
(`mig-<12 hex>.php` in FTP mode) that carries no identifying company name; the temp
directory (`.mig-tmp-<8 hex>/`), the WordPress plugin (slug `mig-helper`, display name
"Site Migration Helper", no author/URI fields), its option (`mig_helper_token`), its ajax
action (`mig_helper`/`mig_action`) and every internal class/constant name follow the same
"mig" convention, never "mvn". Nothing uploaded to a customer's site should name this tool
or its operator; keep that rule for anything added later.

Temp dir: `<docroot>/.mig-tmp-<8 hex>/` created on first use, containing `.htaccess`
(`Deny from all` / `Require all denied`) and an empty `index.html`. Every state file and
artifact lives there. Its name is returned by `info` as `tmp_dir`.

Actions:
- `info` -> `{ok, php_version, exec: bool, wordpress: bool, wp_version, table_prefix, multisite,
  site_url, db: {name, user, host}, docroot, tmp_dir, disk_free, max_execution_time,
  memory_limit, files: {count, bytes, partial}, plugins: {active: [...], litespeed_cache,
  wp_rocket, object_cache}}`. `files` is a walk with a 15 s budget (`partial:true` when cut).
  Credentials come from `wp-config.php` (also `define` with spaces, `$table_prefix`); a
  non-WordPress docroot returns `wordpress:false` and no db.
- `dump` (optional `db_host, db_user, db_pass, db_name` override) -> chunked and resumable:
  first call starts, every call works about 20 s and returns
  `{ok, done:false, progress:{tables_done, tables_total, rows}}` until
  `{ok, done:true, file:"db.sql.gz", size, tables}`. With `exec` available use `mysqldump`
  (`--single-transaction --quick --skip-lock-tables --routines --triggers --default-character-set=utf8mb4`)
  started in the background (`nohup ... &`) and polled; otherwise stream with `mysqli`:
  `SHOW CREATE TABLE`, `SELECT` in batches of 1000 rows ordered by primary key, values escaped
  with `real_escape_string`, `gzwrite` appended. Output is standard SQL (DROP TABLE IF EXISTS,
  CREATE TABLE, INSERT INTO ... VALUES (...),(...)) loadable by `mysql` on MariaDB 10/11.
  State in `<tmp>/dump.state.json`; `restart=1` starts over.
- `archive` -> same chunked pattern: `{ok, done:false, progress:{files, bytes}}` ...
  `{ok, done:true, parts:[{file:"files.tar.gz", size}]}`. One `tar.gz` of the docroot
  (paths relative to the docroot). Exclusions: the temp dir, `wp-content/cache/*`,
  `wp-content/*cache*/`, `wp-content/ai1wm-backups`, `wp-content/updraft`,
  `wp-content/backups-dup-*`, `*.wpress`, `debug.log`, `error_log`, `.git`. With `exec`: `tar`
  in the background writing to the temp dir, polled through a state file; without: a pure-PHP
  streaming tar writer (ustar headers, 512-byte blocks, `gzopen`/`gzwrite`) that lists files
  once into the state file and resumes from an index cursor. When the docroot is larger than
  1 GB and `exec` is available, produce parts of at most 1 GB (`split -b 1G`) so a broken
  download resumes cheaply.
- `get&file=<name>` -> raw bytes of a file inside the temp dir with `Content-Length`, HTTP
  `Range` support (206, `Content-Range`), `Content-Type: application/octet-stream`. Never a
  path outside the temp dir.
- `cleanup` -> deletes the temp dir and, in FTP mode, the helper file itself -> `{ok:true}`.

Security: constant-time token comparison, optional single allowed IP, expiry, no directory
traversal, credentials never echoed, no `phpinfo`, every response has `Cache-Control: no-store`.

## 2. WordPress plugin packaging (slug `mig-helper`, generic name)

Same core, wrapped as a plugin the tool uploads through wp-admin when the source is
"WordPress login only":
- `mig-helper/mig-helper.php` (plugin header "Site Migration Helper", no author/URI, version
  1.0.0) that `include`s the same agent code with `MIG_AGENT_PLUGIN_MODE` defined; docroot =
  `ABSPATH`; the token and expiry are stored in the option `mig_helper_token` (written on
  activation from the `MIG_HELPER_TOKEN` constant baked into the wrapper the same way as the
  helper).
- Endpoint: `admin-ajax.php?action=mig_helper&mig_action=<a>&token=<t>` registered with
  `wp_ajax_nopriv_mig_helper` and `wp_ajax_mig_helper` (token gated exactly like the file).
- `cleanup` in plugin mode deletes the temp dir and the option, then deactivates and deletes
  the plugin files (`delete_plugins`), so nothing stays on the customer site.
The Go side builds the zip at runtime from the embedded files
(`assets/mvn-agent.php` + `assets/plugin/mvn-migrator.php`; the repo source file names are internal build artifacts and are never the names written to a customer's site).

## 3. Server records (API + UI)

`panel_type` values: `directadmin`, `enhance`, `cpanel` (existing), `ftp`, `wordpress` (new).

- `ftp`: `host`, `port` (default 21), `username`, `password` (encrypted as today),
  `auth_method: "password"`, `metadata: { "site_url": "https://example.com", "ftps": bool,
  "docroot": "" }` (`docroot` = path on the FTP server; empty = auto-detect by looking for
  `wp-config.php` in `/`, `/public_html`, `/httpdocs`, `/www`, `/htdocs`, `/domains/<host>/public_html`,
  `/<host>/public_html`, and one level of subdirectories).
- `wordpress`: `host` = site host (`example.com`), `port` 443, `username` = wp-admin user,
  `password` = wp-admin password, `auth_method: "password"`, `metadata: { "site_url": "https://example.com" }`.

`POST /api/v1/servers/:id/test` for these types returns
`{ "success": bool, "message": string, "info": <info payload from the helper> }`
(runs the probe: connect, find docroot, upload the helper, `info`, `cleanup`).

`GET /api/v1/servers/:id/accounts` for these types returns exactly one account:
`{ username: <slug of the host, e.g. "example_com">, domain: <host>, is_wordpress, php_version,
disk_used, db_size, databases: [name], email_accounts: [], suspended: false }`.

## 4. Export contract (Go connector -> engine)

`agentless.Export(ctx, server, workDir, progress, logFn) (*common.ExportData, error)` writes
`<workDir>/files/domains/<host>/public_html/...` (extracted archive) and
`<workDir>/databases/<dbname>.sql.gz`, and returns `ExportData` with `Account{Username: slug,
Domain: host}`, `Domains: [{Name: host, DocumentRoot: "public_html", PHPVersion: from info}]`,
`Databases: [{Name: dbname, ...}]`, `FilesPath: <workDir>/files`. Progress step names must be
the ones the UI maps: "Exporting domains", "Exporting databases", "Downloading files",
"Export completed". Emails, cron jobs and DNS are empty and one warning line each says so.
Fallback when the helper cannot be reached over HTTP (WAF, no PHP): FTP mirror with `lftp`
(installed in the Docker image) for files; the database then needs the optional direct
MySQL credentials, otherwise the export fails with a clear message.

## 5. Go connector notes (phase 1 implementation, `backend/internal/panels/agentless`)

Additions the Go side relies on; they extend (not change) the contract above.

- Server metadata keys: `site_url`, `ftps` (bool, `"true"` accepted), `docroot`; optional
  `db_host`, `db_user`, `db_pass`, `db_name` (direct MySQL for the lftp fallback; they also
  override the `dump` target when all of host/user/name are set). `last_info` (the helper's
  `info` payload of the last successful probe) and `last_info_at` (RFC3339) are written by the
  tool after `POST /servers/:id/test` and `POST /servers/:id/accounts/refresh`, and dropped
  when the panel type, host or site URL changes. `GET /servers/:id/accounts` reuses `last_info`
  (probing only when there is none); the refresh endpoint always re-probes.
- API validation: `ftp`/`wordpress` require `auth_method: "password"` (password required on
  create); `site_url` must be a full http(s) URL and is mandatory for `wordpress`; ports default
  to 21 / 443. `metadata` in create/update is a JSON object (any value type) merged over the
  stored one; a `null` value deletes a key.
- Website host = host of `site_url` (else the server host, minus a leading `ftp.` in FTP mode),
  minus a leading `www.`; the account username is its slug (`example_com`).
- The token is sent both as `token=` and as `X-MT-Token`. The allowed IP baked into the helper is
  the migration server's public IPv4 (`PUBLIC_IP` env, else the outbound interface when it is
  public, else a 3 s lookup); on a 403 from the helper the tool re-uploads it without an IP pin.
- Site URL order in FTP mode: `site_url`, `https://<host>`, `http://<host>`. A 404, a
  connection error, a WAF status with a non-JSON body or a non-JSON body counts as
  "unreachable" and triggers the lftp fallback; the fallback needs `db_host/db_user/db_pass`
  (+ `db_name`, else taken from wp-config.php) and `mysqldump`/`mariadb-dump` on the migration
  server. Files then go through `lftp mirror --parallel=6 --use-pget-n=3`.
- WordPress mode: blocked uploads (403 / "not allowed" / no upload form) return a message that
  points to a manual install of `/api/v1/servers/<id>/mig-helper.zip` (the endpoint itself is
  phase 2; `agentless.BuildPluginZip` builds the archive). The plugin's `cleanup` is verified on
  plugins.php and, if the plugin is still listed, it is deactivated and deleted through
  plugins.php.
- The Docker image adds `lftp`, GNU `tar`, `gzip` and `mariadb-client`.

## 6. Helper behaviour notes (as built, 2026-09-14)

- `info.tmp_dir` is absolute; `tmp_dir_name` is the basename `.mig-tmp-<8 hex>` where the hex is
  the first 8 chars of `sha256("mig|" + token + "|" + docroot)`.
- exec-mode `dump`/`archive` calls return after at most 5 s (background process polled);
  mysqli / pure-PHP calls work ~20 s. A failed call leaves the state untouched.
- Errors are sticky until `restart=1`; a concurrent call answers `{ok:false,error:"busy",busy:true}`
  and the Go side waits and retries.
- File names in the done answer are authoritative: `db.sql.gz` or `db.sql`, `files.tar.gz` or
  `files.tar`, split parts `files.tar.gz.aa`, `.ab`, ... (exec mode, docroot > 1 GB only).
- PHP-written gzip is multi-member (one member per call); readers must accept that.
- mysqldump falls back to mysqli automatically; `mode` reports which ran. mysqli dumps have no
  triggers/routines; views are DEFINER-stripped.
- `DB_HOST=localhost` without a PHP socket tries the usual socket paths, then TCP 127.0.0.1.
