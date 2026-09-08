import { useEffect, useState } from 'react';
import { Dialog } from '@headlessui/react';
import {
  PlusIcon,
  TrashIcon,
  ServerStackIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { getServers, createServer, deleteServer, testServerConnection, getSSHKeys } from '../api/client';
import type { Server, SSHKey } from '../types';

export default function Servers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [sshKeys, setSSHKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [testingServer, setTestingServer] = useState<string | null>(null);

  const [formData, setFormData] = useState({
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
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [serversData, keysData] = await Promise.all([
        getServers(),
        getSSHKeys(),
      ]);
      setServers(serversData);
      setSSHKeys(keysData);
    } catch (error) {
      toast.error('Failed to fetch servers');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createServer(formData);
      toast.success('Server added successfully');
      setIsModalOpen(false);
      setFormData({
        name: '',
        panel_type: 'directadmin',
        host: '',
        port: 22,
        username: 'root',
        auth_method: 'password',
        password: '',
        ssh_key_id: '',
        api_endpoint: '',
        api_key: '',
      });
      fetchData();
    } catch (error) {
      toast.error('Failed to add server');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this server?')) return;
    try {
      await deleteServer(id);
      toast.success('Server deleted');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete server');
    }
  };

  const handleTest = async (id: string) => {
    setTestingServer(id);
    try {
      const result = await testServerConnection(id);
      if (result.success) {
        toast.success('Connection successful!');
      } else {
        toast.error(`Connection failed: ${result.message}`);
      }
    } catch (error) {
      toast.error('Connection test failed');
    } finally {
      setTestingServer(null);
    }
  };

  const panelTypeLabels: Record<string, string> = {
    directadmin: 'DirectAdmin',
    enhance: 'Enhance',
    cpanel: 'cPanel',
    ftp: 'FTP Only',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Servers</h1>
          <p className="text-gray-600">Manage your connected servers</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn btn-primary flex items-center"
        >
          <PlusIcon className="w-5 h-5 mr-2" />
          Add Server
        </button>
      </div>

      {servers.length === 0 ? (
        <div className="card text-center py-12">
          <ServerStackIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No servers yet</h3>
          <p className="text-gray-500 mb-4">Add your first server to get started</p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="btn btn-primary"
          >
            Add Server
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {servers.map((server) => (
            <div key={server.id} className="card">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                  <div className={`p-2 rounded-lg ${
                    server.panel_type === 'directadmin' ? 'bg-blue-100' :
                    server.panel_type === 'enhance' ? 'bg-purple-100' :
                    server.panel_type === 'cpanel' ? 'bg-orange-100' : 'bg-gray-100'
                  }`}>
                    <ServerStackIcon className={`w-5 h-5 ${
                      server.panel_type === 'directadmin' ? 'text-blue-600' :
                      server.panel_type === 'enhance' ? 'text-purple-600' :
                      server.panel_type === 'cpanel' ? 'text-orange-600' : 'text-gray-600'
                    }`} />
                  </div>
                  <div className="ml-3">
                    <h3 className="font-semibold text-gray-900">{server.name}</h3>
                    <p className="text-sm text-gray-500">{panelTypeLabels[server.panel_type]}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(server.id)}
                  className="text-gray-400 hover:text-red-600 transition-colors"
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Host</span>
                  <span className="text-gray-900">{server.host}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Port</span>
                  <span className="text-gray-900">{server.port}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Username</span>
                  <span className="text-gray-900">{server.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Auth</span>
                  <span className="text-gray-900 capitalize">{server.auth_method.replace('_', ' ')}</span>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100">
                <button
                  onClick={() => handleTest(server.id)}
                  disabled={testingServer === server.id}
                  className="w-full btn btn-secondary flex items-center justify-center"
                >
                  {testingServer === server.id ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-600"></div>
                  ) : (
                    <>
                      <CheckCircleIcon className="w-5 h-5 mr-2" />
                      Test Connection
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Server Modal */}
      <Dialog open={isModalOpen} onClose={() => setIsModalOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-lg w-full bg-white rounded-xl shadow-xl">
            <div className="p-6">
              <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4">
                Add New Server
              </Dialog.Title>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">Server Name</label>
                  <input
                    type="text"
                    className="input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="My Server"
                    required
                  />
                </div>

                <div>
                  <label className="label">Panel Type</label>
                  <select
                    className="input"
                    value={formData.panel_type}
                    onChange={(e) => setFormData({ ...formData, panel_type: e.target.value as Server['panel_type'] })}
                  >
                    <option value="directadmin">DirectAdmin</option>
                    <option value="enhance">Enhance</option>
                    <option value="cpanel">cPanel</option>
                    <option value="ftp">FTP Only</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Host</label>
                    <input
                      type="text"
                      className="input"
                      value={formData.host}
                      onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                      placeholder="server.example.com"
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Port</label>
                    <input
                      type="number"
                      className="input"
                      value={formData.port}
                      onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                    />
                  </div>
                </div>

                <div>
                  <label className="label">Username</label>
                  <input
                    type="text"
                    className="input"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="label">Authentication Method</label>
                  <select
                    className="input"
                    value={formData.auth_method}
                    onChange={(e) => setFormData({ ...formData, auth_method: e.target.value as Server['auth_method'] })}
                  >
                    <option value="password">Password</option>
                    <option value="ssh_key">SSH Key</option>
                    <option value="api_key">API Key</option>
                  </select>
                </div>

                {formData.auth_method === 'password' && (
                  <div>
                    <label className="label">Password</label>
                    <input
                      type="password"
                      className="input"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    />
                  </div>
                )}

                {formData.auth_method === 'ssh_key' && (
                  <div>
                    <label className="label">SSH Key</label>
                    <select
                      className="input"
                      value={formData.ssh_key_id}
                      onChange={(e) => setFormData({ ...formData, ssh_key_id: e.target.value })}
                    >
                      <option value="">Select SSH Key</option>
                      {sshKeys.map((key) => (
                        <option key={key.id} value={key.id}>{key.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {formData.auth_method === 'api_key' && (
                  <>
                    <div>
                      <label className="label">API Endpoint</label>
                      <input
                        type="url"
                        className="input"
                        value={formData.api_endpoint}
                        onChange={(e) => setFormData({ ...formData, api_endpoint: e.target.value })}
                        placeholder="https://api.enhance.com"
                      />
                    </div>
                    <div>
                      <label className="label">API Key</label>
                      <input
                        type="password"
                        className="input"
                        value={formData.api_key}
                        onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                      />
                    </div>
                  </>
                )}

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add Server
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
