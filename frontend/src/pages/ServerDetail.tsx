import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Dialog } from '@headlessui/react';
import {
  ArrowLeftIcon,
  GlobeAltIcon,
  EnvelopeIcon,
  CircleStackIcon,
  ServerStackIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { getServer, getServerAccounts, getServerInfo, testServerConnection, updateServer, getSSHKeys } from '../api/client';
import type { Server, Account, SSHKey } from '../types';

interface ServerAccounts {
  accounts: Account[];
  total: number;
}

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [server, setServer] = useState<Server | null>(null);
  const [accounts, setAccounts] = useState<ServerAccounts | null>(null);
  const [sshKeys, setSSHKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'success' | 'failed'>('unknown');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [emailModalAccount, setEmailModalAccount] = useState<Account | null>(null);
  const [dbModalAccount, setDbModalAccount] = useState<Account | null>(null);
  const [serverInfo, setServerInfo] = useState<{
    web_server?: string;
    total_disk?: string;
    used_disk?: string;
    os_version?: string;
    php_versions?: string;
  } | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    panel_type: 'directadmin' as Server['panel_type'],
    host: '',
    port: 22,
    username: 'root',
    auth_method: 'password' as Server['auth_method'],
    password: '',
    ssh_key_id: '',
    api_endpoint: '',
    api_key: '',
  });

  useEffect(() => {
    if (id) {
      loadServer();
      loadSSHKeys();
    }
  }, [id]);

  const loadServer = async () => {
    try {
      const data = await getServer(id!);
      setServer(data);
      setEditFormData({
        name: data.name,
        panel_type: data.panel_type,
        host: data.host,
        port: data.port,
        username: data.username,
        auth_method: data.auth_method,
        password: '',
        ssh_key_id: data.ssh_key_id || '',
        api_endpoint: data.api_endpoint || '',
        api_key: '',
      });
    } catch (error) {
      toast.error('Failed to load server');
      navigate('/servers');
    } finally {
      setLoading(false);
    }
  };

  const loadSSHKeys = async () => {
    try {
      const keys = await getSSHKeys();
      setSSHKeys(keys);
    } catch (error) {
      console.error('Failed to load SSH keys:', error);
    }
  };

  const loadServerInfo = async () => {
    if (!id) return;
    try {
      const info = await getServerInfo(id);
      setServerInfo(info);
    } catch (error) {
      console.error('Failed to load server info:', error);
    }
  };

  const handleTestConnection = async () => {
    if (!id) return;
    setTesting(true);
    try {
      const result = await testServerConnection(id);
      if (result.success) {
        setConnectionStatus('success');
        toast.success('Connection successful!');
        loadAccounts();
        loadServerInfo();
      } else {
        setConnectionStatus('failed');
        toast.error(result.message || 'Connection failed');
      }
    } catch (error) {
      setConnectionStatus('failed');
      toast.error('Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const loadAccounts = async () => {
    if (!id) return;
    setLoadingAccounts(true);
    try {
      const data = await getServerAccounts(id);
      setAccounts(data);
    } catch (error) {
      toast.error('Failed to load accounts');
    } finally {
      setLoadingAccounts(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    try {
      await updateServer(id, editFormData);
      toast.success('Server updated successfully');
      setIsEditModalOpen(false);
      loadServer();
    } catch (error) {
      toast.error('Failed to update server');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!server) {
    return <div>Server not found</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/servers')}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{server.name}</h1>
            <p className="text-gray-500">{server.panel_type} • {server.host}:{server.port}</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {connectionStatus === 'success' && (
            <span className="flex items-center text-green-600">
              <CheckCircleIcon className="h-5 w-5 mr-1" />
              Connected
            </span>
          )}
          {connectionStatus === 'failed' && (
            <span className="flex items-center text-red-600">
              <XCircleIcon className="h-5 w-5 mr-1" />
              Failed
            </span>
          )}
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            <PencilIcon className="h-5 w-5 mr-2" />
            Edit
          </button>
          <button
            onClick={handleTestConnection}
            disabled={testing}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {testing ? (
              <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
            ) : (
              <ServerStackIcon className="h-5 w-5 mr-2" />
            )}
            {testing ? 'Testing...' : 'Test & Load Data'}
          </button>
        </div>
      </div>

      {/* Server Info */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Server Information</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div>
            <p className="text-sm text-gray-500">Host</p>
            <p className="font-medium">{server.host}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Port</p>
            <p className="font-medium">{server.port}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Username</p>
            <p className="font-medium">{server.username}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Auth Method</p>
            <p className="font-medium capitalize">{server.auth_method}</p>
          </div>
          {serverInfo?.web_server && (
            <div>
              <p className="text-sm text-gray-500">Web Server</p>
              <p className="font-medium text-orange-600">{serverInfo.web_server}</p>
            </div>
          )}
          {serverInfo?.total_disk && (
            <div>
              <p className="text-sm text-gray-500">Disk Usage</p>
              <p className="font-medium">{serverInfo.used_disk} / {serverInfo.total_disk}</p>
            </div>
          )}
          {accounts && (
            <>
              <div>
                <p className="text-sm text-gray-500">Total Accounts</p>
                <p className="font-medium text-blue-600">{accounts.total}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Databases</p>
                <p className="font-medium text-purple-600">
                  {accounts.accounts.reduce((sum, acc) => sum + (acc.databases?.length || 0), 0)}
                </p>
              </div>
            </>
          )}
          {serverInfo?.os_version && (
            <div className="col-span-2">
              <p className="text-sm text-gray-500">OS</p>
              <p className="font-medium text-sm">{serverInfo.os_version}</p>
            </div>
          )}
        </div>
      </div>

      {/* Accounts List */}
      {loadingAccounts ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-500">Loading accounts...</span>
          </div>
        </div>
      ) : accounts && accounts.accounts.length > 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold">
              Accounts ({accounts.total})
            </h2>
          </div>
          {/* Table Header */}
          <div className="hidden md:grid md:grid-cols-12 gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase">
            <div className="col-span-3">Domain</div>
            <div className="col-span-1 text-center">Type</div>
            <div className="col-span-1 text-center">PHP</div>
            <div className="col-span-1 text-center">Disk</div>
            <div className="col-span-1 text-center">DB Size</div>
            <div className="col-span-1 text-center">DBs</div>
            <div className="col-span-2 text-center">Emails</div>
            <div className="col-span-2 text-center">Status</div>
          </div>
          <div className="divide-y divide-gray-200">
            {accounts.accounts.map((account) => (
              <div
                key={account.username}
                className="grid grid-cols-1 md:grid-cols-12 gap-2 px-4 py-3 hover:bg-gray-50 items-center text-sm"
              >
                {/* Domain & User */}
                <div className="col-span-3 flex items-center space-x-3">
                  <div className="p-1.5 bg-blue-100 rounded-lg flex-shrink-0">
                    <GlobeAltIcon className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{account.domain}</p>
                    <p className="text-xs text-gray-500 truncate">{account.username}</p>
                  </div>
                </div>

                {/* WordPress Badge */}
                <div className="col-span-1 text-center">
                  {account.is_wordpress ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                      WP
                    </span>
                  ) : (
                    <span className="text-gray-400 text-xs">-</span>
                  )}
                </div>

                {/* PHP Version */}
                <div className="col-span-1 text-center">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                    {account.php_version || '?'}
                  </span>
                </div>

                {/* Disk Usage */}
                <div className="col-span-1 text-center">
                  <span className="font-medium">{account.disk_used || '-'}</span>
                </div>

                {/* DB Size */}
                <div className="col-span-1 text-center">
                  <span className="text-gray-600">{account.db_size || '-'}</span>
                </div>

                {/* Databases Count */}
                <div className="col-span-1 text-center">
                  {account.databases && account.databases.length > 0 ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDbModalAccount(account); }}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 cursor-pointer"
                    >
                      <CircleStackIcon className="h-3 w-3 mr-1" />
                      {account.databases.length}
                    </button>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </div>

                {/* Email Accounts */}
                <div className="col-span-2 text-center">
                  {account.email_accounts && account.email_accounts.length > 0 ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEmailModalAccount(account); }}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer"
                    >
                      <EnvelopeIcon className="h-3 w-3 mr-1" />
                      {account.email_accounts.length} emails
                    </button>
                  ) : (
                    <span className="text-gray-400 text-xs">No emails</span>
                  )}
                </div>

                {/* Status Badges */}
                <div className="col-span-2 flex items-center justify-center space-x-1">
                  {account.ssl_enabled && (
                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                      SSL
                    </span>
                  )}
                  {account.suspended ? (
                    <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs">
                      Suspended
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                      Active
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : connectionStatus === 'success' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <p className="text-gray-500">No accounts found on this server</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <ServerStackIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 mb-4">Click "Test & Load Data" to connect and view accounts</p>
        </div>
      )}

      {/* Edit Server Modal */}
      <Dialog open={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-lg w-full bg-white rounded-xl shadow-xl">
            <div className="p-6">
              <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4">
                Edit Server
              </Dialog.Title>

              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label className="label">Server Name</label>
                  <input
                    type="text"
                    className="input"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    placeholder="My Server"
                    required
                  />
                </div>

                <div>
                  <label className="label">Panel Type</label>
                  <select
                    className="input"
                    value={editFormData.panel_type}
                    onChange={(e) => setEditFormData({ ...editFormData, panel_type: e.target.value as Server['panel_type'] })}
                  >
                    <option value="directadmin">DirectAdmin</option>
                    <option value="enhance">Enhance</option>
                    <option value="cpanel">cPanel</option>
                    <option value="cloudpanel">CloudPanel</option>
                    <option value="ftp">FTP Only</option>
                    <option value="wordpress">WordPress Only</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Host</label>
                    <input
                      type="text"
                      className="input"
                      value={editFormData.host}
                      onChange={(e) => setEditFormData({ ...editFormData, host: e.target.value })}
                      placeholder="server.example.com"
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Port</label>
                    <input
                      type="number"
                      className="input"
                      value={editFormData.port}
                      onChange={(e) => setEditFormData({ ...editFormData, port: parseInt(e.target.value) })}
                    />
                  </div>
                </div>

                <div>
                  <label className="label">Username</label>
                  <input
                    type="text"
                    className="input"
                    value={editFormData.username}
                    onChange={(e) => setEditFormData({ ...editFormData, username: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="label">Authentication Method</label>
                  <select
                    className="input"
                    value={editFormData.auth_method}
                    onChange={(e) => setEditFormData({ ...editFormData, auth_method: e.target.value as Server['auth_method'] })}
                  >
                    <option value="password">Password</option>
                    <option value="ssh_key">SSH Key</option>
                    <option value="api_key">API Key</option>
                  </select>
                </div>

                {editFormData.auth_method === 'password' && (
                  <div>
                    <label className="label">Password (leave empty to keep current)</label>
                    <input
                      type="password"
                      className="input"
                      value={editFormData.password}
                      onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                      placeholder="••••••••"
                    />
                  </div>
                )}

                {editFormData.auth_method === 'ssh_key' && (
                  <div>
                    <label className="label">SSH Key</label>
                    <select
                      className="input"
                      value={editFormData.ssh_key_id}
                      onChange={(e) => setEditFormData({ ...editFormData, ssh_key_id: e.target.value })}
                    >
                      <option value="">Select SSH Key</option>
                      {sshKeys.map((key) => (
                        <option key={key.id} value={key.id}>{key.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {editFormData.auth_method === 'api_key' && (
                  <>
                    <div>
                      <label className="label">API Endpoint</label>
                      <input
                        type="url"
                        className="input"
                        value={editFormData.api_endpoint}
                        onChange={(e) => setEditFormData({ ...editFormData, api_endpoint: e.target.value })}
                        placeholder="https://api.enhance.com"
                      />
                    </div>
                    <div>
                      <label className="label">API Key (leave empty to keep current)</label>
                      <input
                        type="password"
                        className="input"
                        value={editFormData.api_key}
                        onChange={(e) => setEditFormData({ ...editFormData, api_key: e.target.value })}
                        placeholder="••••••••"
                      />
                    </div>
                  </>
                )}

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>

      {/* Email List Modal */}
      <Dialog open={emailModalAccount !== null} onClose={() => setEmailModalAccount(null)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-md w-full bg-white rounded-xl shadow-xl">
            <div className="p-6">
              <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <EnvelopeIcon className="h-5 w-5 mr-2 text-blue-600" />
                Email Accounts - {emailModalAccount?.domain}
              </Dialog.Title>
              <div className="max-h-80 overflow-y-auto">
                {emailModalAccount?.email_accounts?.map((email, idx) => (
                  <div key={idx} className="py-2 px-3 border-b border-gray-100 last:border-0 text-sm">
                    {email}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setEmailModalAccount(null)}
                  className="btn btn-secondary"
                >
                  Close
                </button>
              </div>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>

      {/* Database List Modal */}
      <Dialog open={dbModalAccount !== null} onClose={() => setDbModalAccount(null)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-md w-full bg-white rounded-xl shadow-xl">
            <div className="p-6">
              <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <CircleStackIcon className="h-5 w-5 mr-2 text-purple-600" />
                Databases - {dbModalAccount?.domain}
              </Dialog.Title>
              <div className="max-h-80 overflow-y-auto">
                {dbModalAccount?.databases?.map((db, idx) => (
                  <div key={idx} className="py-2 px-3 border-b border-gray-100 last:border-0 text-sm flex justify-between">
                    <span>{db}</span>
                  </div>
                ))}
              </div>
              {dbModalAccount?.db_size && (
                <div className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-600">
                  Total Size: <span className="font-medium">{dbModalAccount.db_size}</span>
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setDbModalAccount(null)}
                  className="btn btn-secondary"
                >
                  Close
                </button>
              </div>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
}
