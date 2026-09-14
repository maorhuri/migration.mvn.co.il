import axios from 'axios';
import type { Server, SSHKey, Migration, MigrationLog, Account, CompatibilityResult } from '../types';

const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Servers
export const getServers = async (): Promise<Server[]> => {
  const { data } = await api.get('/servers');
  return data.items || [];
};

export const getServer = async (id: string): Promise<Server> => {
  const { data } = await api.get(`/servers/${id}`);
  return data;
};

export const createServer = async (server: Partial<Server> & { password?: string; api_key?: string }): Promise<Server> => {
  const { data } = await api.post('/servers', server);
  return data;
};

export const updateServer = async (id: string, server: Partial<Server> & { password?: string; api_key?: string }): Promise<Server> => {
  const { data } = await api.put(`/servers/${id}`, server);
  return data;
};

export const deleteServer = async (id: string): Promise<void> => {
  await api.delete(`/servers/${id}`);
};

export const testServerConnection = async (id: string): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post(`/servers/${id}/test`);
  return data;
};

export const getServerAccounts = async (id: string): Promise<{ accounts: Account[]; total: number }> => {
  const { data } = await api.get(`/servers/${id}/accounts`);
  return { accounts: data.accounts || [], total: data.total || 0 };
};

export const getServerInfo = async (id: string): Promise<{
  web_server?: string;
  total_disk?: string;
  used_disk?: string;
  os_version?: string;
  php_versions?: string;
}> => {
  const { data } = await api.get(`/servers/${id}/info`);
  return data;
};

export interface ClusterServer {
  id: string;
  friendly_name: string;
  hostname: string;
  ip: string;
  role: string;
  roles?: string[];
  is_main: boolean;
  status: string;
}

export const getClusterServers = async (id: string): Promise<ClusterServer[]> => {
  const { data } = await api.get(`/servers/${id}/cluster-servers`);
  return data.items || [];
};

// Refresh server accounts (force reload from server)
export const refreshServerAccounts = async (id: string): Promise<{ accounts: Account[]; total: number }> => {
  const { data } = await api.post(`/servers/${id}/accounts/refresh`);
  return data;
};

// SSH Keys
export const getSSHKeys = async (): Promise<SSHKey[]> => {
  const { data } = await api.get('/ssh-keys');
  return data.items || [];
};

export const createSSHKey = async (key: { name: string; public_key: string; private_key: string; passphrase?: string }): Promise<SSHKey> => {
  const { data } = await api.post('/ssh-keys', key);
  return data;
};

export const deleteSSHKey = async (id: string): Promise<void> => {
  await api.delete(`/ssh-keys/${id}`);
};

// Generate an ed25519 key pair server-side and store it.
export const generateSSHKey = async (params: { name: string }): Promise<SSHKey> => {
  const { data } = await api.post('/ssh-keys/generate', params);
  return data;
};

// Mark a key as the default used for Enhance cluster nodes.
export const setDefaultSSHKey = async (id: string): Promise<void> => {
  await api.put(`/ssh-keys/${id}/default`);
};

// Clear the default flag from a key.
export const unsetDefaultSSHKey = async (id: string): Promise<void> => {
  await api.delete(`/ssh-keys/${id}/default`);
};

// Migrations
export const getMigrations = async (): Promise<Migration[]> => {
  const { data } = await api.get('/migrations');
  return data.items || [];
};

export const getMigration = async (id: string): Promise<Migration> => {
  const { data } = await api.get(`/migrations/${id}`);
  return data;
};

export const startMigration = async (params: {
  source_server_id: string;
  target_server_id: string;
  target_cluster_server_id?: string;
  username: string;
  new_password?: string;
  scan_malware?: boolean;
}): Promise<Migration> => {
  const { data } = await api.post('/migrations', params);
  return data;
};

export const getMigrationLogs = async (id: string): Promise<MigrationLog[]> => {
  const { data } = await api.get(`/migrations/${id}/logs`);
  return data.items || [];
};

export const cancelMigration = async (id: string): Promise<void> => {
  await api.post(`/migrations/${id}/cancel`);
};

export const deleteMigration = async (id: string): Promise<void> => {
  await api.delete(`/migrations/${id}`);
};

/** Re-run WordPress registration, PHP version and ownership for a completed migration. */
export const repairMigrationWordPress = async (id: string): Promise<{ migration: Migration; summary: string[] }> => {
  const { data } = await api.post(`/migrations/${id}/repair/wordpress`);
  return data;
};

/** Operator decision on malware-scan findings while the migration waits: clean | skip | abort. */
export const submitScanDecision = async (id: string, action: 'clean' | 'skip' | 'abort'): Promise<Migration> => {
  const { data } = await api.post(`/migrations/${id}/scan/decision`, { action });
  return data;
};

/** Delete every finished migration (completed, failed, cancelled) with its logs. Running ones are kept. */
export const clearFinishedMigrations = async (): Promise<{ deleted: number }> => {
  const { data } = await api.post('/migrations/clear');
  return data;
};

/** Suspend the migrated account on the SOURCE panel (manual step after the IP switch). Never automatic. */
export const suspendMigrationSource = async (id: string): Promise<Migration> => {
  const { data } = await api.post(`/migrations/${id}/source/suspend`);
  return data;
};

/** Re-enable the account on the source panel. */
export const unsuspendMigrationSource = async (id: string): Promise<Migration> => {
  const { data } = await api.post(`/migrations/${id}/source/unsuspend`);
  return data;
};

export const checkCompatibility = async (params: {
  source_server_id: string;
  target_server_id: string;
  username: string;
}): Promise<CompatibilityResult> => {
  const { data } = await api.post('/migrations/check-compatibility', params);
  return data;
};

export default api;
