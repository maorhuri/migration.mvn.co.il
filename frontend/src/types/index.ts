export interface Server {
  id: string;
  name: string;
  panel_type: 'directadmin' | 'enhance' | 'cpanel' | 'cloudpanel' | 'cloudways' | 'ftp' | 'wordpress';
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'ssh_key' | 'api_key';
  ssh_key_id?: string;
  api_endpoint?: string;
  // Enhance specific
  enhance_org_id?: string;
  /**
   * Free-form settings per panel type. Agentless sources keep their site here:
   * ftp -> { site_url, ftps, docroot }, wordpress -> { site_url }.
   */
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Facts the agentless helper (mvn-agent.php) reports for an FTP / WordPress source.
 * Returned as `info` by POST /servers/:id/test. Every field is optional: an older helper or a
 * non-WordPress docroot leaves parts of it out.
 */
export interface AgentlessInfo {
  ok?: boolean;
  php_version?: string;
  /** Shell commands (mysqldump, tar) can run; otherwise the export is pure PHP. */
  exec?: boolean;
  wordpress?: boolean;
  wp_version?: string;
  table_prefix?: string;
  multisite?: boolean;
  site_url?: string;
  db?: { name?: string; user?: string; host?: string; size?: number | string };
  docroot?: string;
  tmp_dir?: string;
  disk_free?: number;
  max_execution_time?: number | string;
  memory_limit?: string;
  /** Docroot walk with a 15 s budget: `partial` when the budget was hit. */
  files?: { count?: number; bytes?: number; partial?: boolean };
  plugins?: { active?: string[]; litespeed_cache?: boolean; wp_rocket?: boolean; object_cache?: boolean };
  /** True when this came from the FTP-only fallback (the helper could not be reached over HTTP):
   *  only docroot and db (from wp-config.php) are real; everything else here is unknown, not zero. */
  helper_unreachable?: boolean;
}

/** Result of POST /servers/:id/test. `info` is only present for agentless sources. */
export interface ServerTestResponse {
  success: boolean;
  message: string;
  info?: AgentlessInfo;
}

export interface ServerInfo {
  web_server?: string;
  total_disk?: string;
  os_version?: string;
}

export interface SSHKey {
  id: string;
  name: string;
  public_key: string;
  fingerprint?: string;
  created_at: string;
  /** Default key used to SSH into Enhance cluster nodes. */
  is_default?: boolean;
  /** Shell command that installs the public key on a node (run as root). */
  install_command?: string;
}

export interface Account {
  username: string;
  email: string;
  domain: string;
  package?: string;
  disk_used: string;
  disk_limit: string;
  suspended: boolean;
  php_version?: string;
  databases?: string[];
  email_accounts?: string[];
  addon_domains?: string[];
  pointers?: string[];
  ssl_enabled?: boolean;
  ssl_expiry?: string;
  is_wordpress?: boolean;
  db_size?: string;
}

export interface Migration {
  id: string;
  source_server_id: string;
  target_server_id: string;
  account_username: string;
  status: 'pending' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';
  current_step?: string;
  target_ip?: string;
  target_node?: string;
  warnings?: number;
  /** Set once the source account was suspended after the migration (manual step after the IP/DNS switch). */
  source_suspended_at?: string;
  /** Malware scan requested for this run (scan happens on the staging server before upload). */
  scan_requested?: boolean;
  scan_report?: ScanReport;
  /** Operator decision on the findings: clean | skip | abort. */
  scan_decision?: string;
  /** Enhance cluster server the import targeted (recorded for re-runs). */
  target_cluster_server_id?: string;
  total_steps: number;
  completed_steps: number;
  bytes_transferred: number;
  total_bytes: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  /** Export metadata stored by the backend once the source export finished (domains used for the hosts entry). */
  export_data?: {
    /** target_domain, when set, is what actually got registered on the target (a DirectAdmin
     * domain pointer is the account's real, customer-facing domain -- name alone is often just
     * the internal hosting hostname the account was provisioned under). */
    domains?: { name: string; target_domain?: string }[];
    /** Snapshot of the source account as it was when the export ran. */
    account?: {
      domain?: string;
      disk_usage?: string;
      php_version?: string;
      databases?: string[];
      is_wordpress?: boolean;
      db_size?: string;
    };
  };
  /** Live progress block returned by the API; transfer byte counters live here rather than at the top level. */
  progress?: { bytes_transferred?: number; total_bytes?: number };
}

export interface MigrationLog {
  id: string;
  migration_id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  created_at: string;
  /** Structured payload some lines carry (e.g. "Export completed": { domains, databases, emails, cron_jobs }). */
  metadata?: Record<string, unknown> | null;
}

export interface CompatibilityResult {
  compatible: boolean;
  warnings: string[];
  errors: string[];
  mappings: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Malware scan (staging server, before upload)
// ---------------------------------------------------------------------------

export type ScanSeverity = 'critical' | 'high' | 'medium' | 'info';

export interface ScanFinding {
  id: string;
  severity: ScanSeverity;
  category: string;
  domain: string;
  /** Path relative to the docroot, or "db:<table>:<item>" for database findings. */
  path: string;
  evidence?: string;
  line?: number;
  action: 'quarantine' | 'restore_core' | 'remove_lines' | 'report' | string;
  cleanable: boolean;
  cleaned?: boolean;
  note?: string;
}

export interface ScanDomainSummary {
  domain: string;
  files: number;
  bytes: number;
  wordpress: boolean;
  core_version?: string;
  core_checked: boolean;
  core_modified: number;
  core_extra: number;
  core_missing: number;
  core_note?: string;
}

export interface ScanCleanup {
  at: string;
  quarantine_dir: string;
  quarantined: string[];
  restored: string[];
  lines_removed: string[];
  skipped: string[];
  errors: string[];
}

export interface ScanReport {
  scanned_at: string;
  duration_ms: number;
  domains: ScanDomainSummary[];
  files_scanned: number;
  bytes_scanned: number;
  findings: ScanFinding[];
  counts: Partial<Record<ScanSeverity, number>>;
  cleanable: number;
  admin_users: { id: number; login: string; email: string }[];
  databases: string[];
  clamav: string;
  notes?: string[];
  cleanup?: ScanCleanup;
}
