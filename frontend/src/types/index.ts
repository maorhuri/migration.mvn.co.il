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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  current_step?: string;
  target_ip?: string;
  target_node?: string;
  warnings?: number;
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
