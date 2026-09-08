import { useEffect, useState } from 'react';
import { Dialog } from '@headlessui/react';
import {
  PlusIcon,
  TrashIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { getSSHKeys, createSSHKey, deleteSSHKey } from '../api/client';
import type { SSHKey } from '../types';

export default function SSHKeys() {
  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    public_key: '',
    private_key: '',
    passphrase: '',
  });

  useEffect(() => {
    fetchKeys();
  }, []);

  const fetchKeys = async () => {
    try {
      const data = await getSSHKeys();
      setKeys(data);
    } catch (error) {
      toast.error('Failed to fetch SSH keys');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createSSHKey(formData);
      toast.success('SSH key added successfully');
      setIsModalOpen(false);
      setFormData({
        name: '',
        public_key: '',
        private_key: '',
        passphrase: '',
      });
      fetchKeys();
    } catch (error) {
      toast.error('Failed to add SSH key');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this SSH key?')) return;
    try {
      await deleteSSHKey(id);
      toast.success('SSH key deleted');
      fetchKeys();
    } catch (error) {
      toast.error('Failed to delete SSH key');
    }
  };

  const handleFileUpload = (field: 'public_key' | 'private_key') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setFormData({ ...formData, [field]: content });
    };
    reader.readAsText(file);
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
          <h1 className="text-2xl font-bold text-gray-900">SSH Keys</h1>
          <p className="text-gray-600">Manage SSH keys for server authentication</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn btn-primary flex items-center"
        >
          <PlusIcon className="w-5 h-5 mr-2" />
          Add SSH Key
        </button>
      </div>

      {keys.length === 0 ? (
        <div className="card text-center py-12">
          <KeyIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No SSH keys yet</h3>
          <p className="text-gray-500 mb-4">Add SSH keys for secure server authentication</p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="btn btn-primary"
          >
            Add SSH Key
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {keys.map((key) => (
            <div key={key.id} className="card">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <KeyIcon className="w-5 h-5 text-gray-600" />
                  </div>
                  <div className="ml-3">
                    <h3 className="font-semibold text-gray-900">{key.name}</h3>
                    {key.fingerprint && (
                      <p className="text-xs text-gray-500 font-mono truncate max-w-[200px]">
                        {key.fingerprint}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(key.id)}
                  className="text-gray-400 hover:text-red-600 transition-colors"
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-500">Public Key</span>
                  <p className="text-gray-900 font-mono text-xs truncate mt-1">
                    {key.public_key.substring(0, 50)}...
                  </p>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Created</span>
                  <span className="text-gray-900">
                    {new Date(key.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add SSH Key Modal */}
      <Dialog open={isModalOpen} onClose={() => setIsModalOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-lg w-full bg-white rounded-xl shadow-xl">
            <div className="p-6">
              <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4">
                Add SSH Key
              </Dialog.Title>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">Key Name</label>
                  <input
                    type="text"
                    className="input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="My SSH Key"
                    required
                  />
                </div>

                <div>
                  <label className="label">Public Key</label>
                  <div className="flex space-x-2">
                    <textarea
                      className="input font-mono text-xs"
                      rows={3}
                      value={formData.public_key}
                      onChange={(e) => setFormData({ ...formData, public_key: e.target.value })}
                      placeholder="ssh-rsa AAAA..."
                      required
                    />
                  </div>
                  <input
                    type="file"
                    accept=".pub"
                    onChange={handleFileUpload('public_key')}
                    className="mt-2 text-sm text-gray-500"
                  />
                </div>

                <div>
                  <label className="label">Private Key</label>
                  <textarea
                    className="input font-mono text-xs"
                    rows={3}
                    value={formData.private_key}
                    onChange={(e) => setFormData({ ...formData, private_key: e.target.value })}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    required
                  />
                  <input
                    type="file"
                    onChange={handleFileUpload('private_key')}
                    className="mt-2 text-sm text-gray-500"
                  />
                </div>

                <div>
                  <label className="label">Passphrase (Optional)</label>
                  <input
                    type="password"
                    className="input"
                    value={formData.passphrase}
                    onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
                    placeholder="Leave empty if no passphrase"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add Key
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
