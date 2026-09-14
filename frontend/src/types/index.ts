export interface Server {
  id: string;
  name: string;
  panel_type: 'directadmin' | 'enhance' | 'cpanel' | 'cloudpanel' | 'ftp' | 'wordpress';
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'ssh_key' | 'api_key';
  ssh_key_id?: string;
  api_endpoint?: string;
  // Enhance specific
  enhance_org_id?: string;
  created_at: string;
  updated_at: string;
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
  total_steps: number;
  completed_steps: number;
  bytes_transferred: number;
  total_bytes: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  /** Export metadata stored by the backend once the source export finished (domains used for the hosts entry). */
  export_data?: { domains?: { name: string }[] };
  /** Live progress block returned by the API; transfer byte counters live here rather than at the top level. */
  progress?: { bytes_transferred?: number; total_bytes?: number };
}

export interface MigrationLog {
  id: string;
  migration_id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  created_at: string;
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
