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
  created_at: string;
  updated_at: string;
}

export interface SSHKey {
  id: string;
  name: string;
  public_key: string;
  fingerprint?: string;
  created_at: string;
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
}

export interface Migration {
  id: string;
  source_server_id: string;
  target_server_id: string;
  account_username: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  current_step?: string;
  total_steps: number;
  completed_steps: number;
  bytes_transferred: number;
  total_bytes: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
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
