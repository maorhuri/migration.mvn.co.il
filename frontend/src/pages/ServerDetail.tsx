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
import { getServer, getServerAccounts, testServerConnection, updateServer, getSSHKeys } from '../api/client';
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
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
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

  const handleTestConnection = async () => {
    if (!id) return;
    setTesting(true);
    try {
      const result = await testServerConnection(id);
      if (result.success) {
        setConnectionStatus('success');
        toast.success('Connection successful!');
        loadAccounts();
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
          <div className="divide-y divide-gray-200">
            {accounts.accounts.map((account) => (
              <div
                key={account.username}
                className="p-4 hover:bg-gray-50 cursor-pointer"
                onClick={() => setSelectedAccount(selectedAccount?.username === account.username ? null : account)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <GlobeAltIcon className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium">{account.domain}</p>
                      <p className="text-sm text-gray-500">User: {account.username}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-6 text-sm">
                    <div className="text-center">
                      <p className="text-gray-500">Disk</p>
                      <p className="font-medium">{account.disk_used} / {account.disk_limit}</p>
                    </div>
                    {account.php_version && (
                      <div className="text-center">
                        <p className="text-gray-500">PHP</p>
                        <p className="font-medium">{account.php_version}</p>
                      </div>
                    )}
                    {account.ssl_enabled && (
                      <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
                        SSL
                      </span>
                    )}
                    {account.suspended && (
                      <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs">
                        Suspended
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {selectedAccount?.username === account.username && (
                  <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Databases */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <CircleStackIcon className="h-5 w-5 text-purple-600 mr-2" />
                        <h4 className="font-medium">Databases</h4>
                      </div>
                      {account.databases && account.databases.length > 0 ? (
                        <ul className="text-sm space-y-1">
                          {account.databases.map((db) => (
                            <li key={db} className="text-gray-600">{db}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-gray-400">No databases</p>
                      )}
                    </div>

                    {/* Email Accounts */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <EnvelopeIcon className="h-5 w-5 text-blue-600 mr-2" />
                        <h4 className="font-medium">Email Accounts</h4>
                      </div>
                      {account.email_accounts && account.email_accounts.length > 0 ? (
                        <ul className="text-sm space-y-1">
                          {account.email_accounts.slice(0, 5).map((email) => (
                            <li key={email} className="text-gray-600">{email}</li>
                          ))}
                          {account.email_accounts.length > 5 && (
                            <li className="text-gray-400">+{account.email_accounts.length - 5} more</li>
                          )}
                        </ul>
                      ) : (
                        <p className="text-sm text-gray-400">No email accounts</p>
                      )}
                    </div>

                    {/* Addon Domains */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <GlobeAltIcon className="h-5 w-5 text-green-600 mr-2" />
                        <h4 className="font-medium">Addon Domains</h4>
                      </div>
                      {account.addon_domains && account.addon_domains.length > 0 ? (
                        <ul className="text-sm space-y-1">
                          {account.addon_domains.map((domain) => (
                            <li key={domain} className="text-gray-600">{domain}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-gray-400">No addon domains</p>
                      )}
                    </div>

                    {/* SSL Info */}
                    {account.ssl_enabled && account.ssl_expiry && (
                      <div className="md:col-span-3 bg-green-50 rounded-lg p-4">
                        <p className="text-sm text-green-700">
                          <strong>SSL Certificate:</strong> Valid until {account.ssl_expiry}
                        </p>
                      </div>
                    )}
                  </div>
                )}
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
    </div>
  );
}
