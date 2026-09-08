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
  username: string;
  new_password?: string;
}): Promise<Migration> => {
  const { data } = await api.post('/migrations', params);
  return data;
};

export const getMigrationLogs = async (id: string): Promise<MigrationLog[]> => {
  const { data } = await api.get(`/migrations/${id}/logs`);
  return data.items || [];
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
