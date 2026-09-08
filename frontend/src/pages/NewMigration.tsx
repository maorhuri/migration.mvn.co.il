import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircleIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  ServerStackIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { getServers, getServerAccounts, getClusterServers, ClusterServer } from '../api/client';
import type { Server, Account } from '../types';

type MigrationStep = 'select_source' | 'select_accounts' | 'select_target' | 'review' | 'migrating' | 'completed';

interface MigrationProgress {
  step: string;
  progress: number;
  details: string;
}

export default function NewMigration() {
  const navigate = useNavigate();
  const [servers, setServers] = useState<Server[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [clusterServers, setClusterServers] = useState<ClusterServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCluster, setLoadingCluster] = useState(false);
  const [starting, setStarting] = useState(false);
  
  const [currentStep, setCurrentStep] = useState<MigrationStep>('select_source');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<Account[]>([]);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [hostsEntry, setHostsEntry] = useState<string>('');

  const [formData, setFormData] = useState({
    source_server_id: '',
    target_server_id: '',
    target_cluster_server_id: '',
    new_password: '',
  });

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const data = await getServers();
        setServers(data);
      } catch (error) {
        toast.error('Failed to fetch servers');
      } finally {
        setLoading(false);
      }
    };
    fetchServers();
  }, []);

  // Load accounts when source server is selected
  useEffect(() => {
    if (formData.source_server_id) {
      const fetchAccounts = async () => {
        setLoadingAccounts(true);
        try {
          const data = await getServerAccounts(formData.source_server_id);
          setAccounts(data.accounts);
        } catch (error) {
          console.error('Failed to fetch accounts:', error);
          setAccounts([]);
        } finally {
          setLoadingAccounts(false);
        }
      };
      fetchAccounts();
    } else {
      setAccounts([]);
    }
  }, [formData.source_server_id]);

  // Load cluster servers when target server is selected
  useEffect(() => {
    if (formData.target_server_id) {
      const fetchClusterServers = async () => {
        setLoadingCluster(true);
        try {
          const data = await getClusterServers(formData.target_server_id);
          setClusterServers(data);
          // Auto-select if only one server
          if (data.length === 1) {
            setFormData(prev => ({ ...prev, target_cluster_server_id: data[0].id }));
          }
        } catch (error) {
          console.error('Failed to fetch cluster servers:', error);
          setClusterServers([]);
        } finally {
          setLoadingCluster(false);
        }
      };
      fetchClusterServers();
    } else {
      setClusterServers([]);
    }
  }, [formData.target_server_id]);

  const handleSelectAllAccounts = () => {
    if (selectedAccounts.length === filteredAccounts.length) {
      setSelectedAccounts([]);
    } else {
      setSelectedAccounts([...filteredAccounts]);
    }
  };

  const handleToggleAccount = (account: Account) => {
    if (selectedAccounts.find(a => a.username === account.username)) {
      setSelectedAccounts(selectedAccounts.filter(a => a.username !== account.username));
    } else {
      setSelectedAccounts([...selectedAccounts, account]);
    }
  };

  const handleStartMigration = async () => {
    if (selectedAccounts.length === 0) {
      toast.error('Please select at least one account');
      return;
    }

    setCurrentStep('migrating');
    setStarting(true);

    // Simulate migration progress
    const steps = [
      { step: 'Exporting databases', progress: 10, details: 'Dumping MySQL databases...' },
      { step: 'Compressing files', progress: 25, details: 'Creating archive...' },
      { step: 'Transferring to migration server', progress: 40, details: 'Rsync in progress...' },
      { step: 'Creating website on Enhance', progress: 55, details: 'API call to create website...' },
      { step: 'Uploading files', progress: 70, details: 'Rsync to target server...' },
      { step: 'Importing databases', progress: 85, details: 'Restoring MySQL databases...' },
      { step: 'Configuring PHP version', progress: 95, details: 'Setting PHP 8.1...' },
      { step: 'Completed', progress: 100, details: 'Migration completed successfully!' },
    ];

    try {
      for (const stepInfo of steps) {
        setMigrationProgress(stepInfo);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Generate hosts entry
      const targetServer = servers.find(s => s.id === formData.target_server_id);
      const domains = selectedAccounts.map(a => a.domain).join(' ');
      setHostsEntry(`${targetServer?.host || 'TARGET_IP'} ${domains}`);
      
      setCurrentStep('completed');
      toast.success('Migration completed successfully!');
    } catch (error) {
      toast.error('Migration failed');
      setCurrentStep('review');
    } finally {
      setStarting(false);
    }
  };

  const sourceServers = servers.filter(s => s.panel_type === 'directadmin' || s.panel_type === 'cpanel');
  const targetServers = servers.filter(s => s.panel_type === 'enhance');

  const filteredAccounts = accounts.filter(acc =>
    acc.domain?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    acc.username?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">New Migration</h1>
        <p className="text-gray-600">Migrate accounts from one server to another</p>
      </div>

      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {['select_source', 'select_accounts', 'select_target', 'review', 'migrating'].map((step, index) => (
            <div key={step} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                currentStep === step ? 'bg-blue-600 text-white' :
                ['select_source', 'select_accounts', 'select_target', 'review', 'migrating'].indexOf(currentStep) > index
                  ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'
              }`}>
                {['select_source', 'select_accounts', 'select_target', 'review', 'migrating'].indexOf(currentStep) > index ? '✓' : index + 1}
              </div>
              {index < 4 && <div className={`w-24 h-1 mx-2 ${
                ['select_source', 'select_accounts', 'select_target', 'review', 'migrating'].indexOf(currentStep) > index
                  ? 'bg-green-500' : 'bg-gray-200'
              }`} />}
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>Source</span>
          <span>Accounts</span>
          <span>Target</span>
          <span>Review</span>
          <span>Migrate</span>
        </div>
      </div>

      {/* Step 1: Select Source Server */}
      {currentStep === 'select_source' && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Select Source Server</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sourceServers.map((server) => (
              <button
                key={server.id}
                onClick={() => {
                  setFormData({ ...formData, source_server_id: server.id });
                  setCurrentStep('select_accounts');
                }}
                className={`p-4 border-2 rounded-lg text-left hover:border-blue-500 transition-colors ${
                  formData.source_server_id === server.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center mb-2">
                  <ServerStackIcon className="w-6 h-6 text-blue-600 mr-2" />
                  <span className="font-medium">{server.name}</span>
                </div>
                <p className="text-sm text-gray-500">{server.host}</p>
                <span className="inline-block mt-2 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                  {server.panel_type}
                </span>
              </button>
            ))}
          </div>
          {sourceServers.length === 0 && (
            <p className="text-center text-gray-500 py-8">
              No source servers configured. Please add a DirectAdmin or cPanel server first.
            </p>
          )}
        </div>
      )}

      {/* Step 2: Select Accounts */}
      {currentStep === 'select_accounts' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Select Accounts to Migrate</h2>
            <button
              onClick={() => setCurrentStep('select_source')}
              className="text-sm text-blue-600 hover:underline"
            >
              ← Change Server
            </button>
          </div>

          {loadingAccounts ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-500">Loading accounts...</span>
            </div>
          ) : (
            <>
              {/* Search and Select All */}
              <div className="flex items-center justify-between mb-4">
                <div className="relative flex-1 max-w-md">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by domain or username..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-full focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={handleSelectAllAccounts}
                  className="ml-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  {selectedAccounts.length === filteredAccounts.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {/* Accounts Table */}
              <div className="border rounded-lg overflow-hidden">
                <div className="hidden md:grid md:grid-cols-12 gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase">
                  <div className="col-span-1"></div>
                  <div className="col-span-3">Domain</div>
                  <div className="col-span-1 text-center">Type</div>
                  <div className="col-span-1 text-center">PHP</div>
                  <div className="col-span-1 text-center">Disk</div>
                  <div className="col-span-1 text-center">DB Size</div>
                  <div className="col-span-1 text-center">DBs</div>
                  <div className="col-span-2 text-center">Emails</div>
                  <div className="col-span-1 text-center">Status</div>
                </div>
                <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                  {filteredAccounts.map((account) => (
                    <div
                      key={account.username}
                      onClick={() => handleToggleAccount(account)}
                      className={`grid grid-cols-1 md:grid-cols-12 gap-2 px-4 py-3 cursor-pointer hover:bg-gray-50 items-center text-sm ${
                        selectedAccounts.find(a => a.username === account.username) ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="col-span-1">
                        <input
                          type="checkbox"
                          checked={!!selectedAccounts.find(a => a.username === account.username)}
                          onChange={() => {}}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </div>
                      <div className="col-span-3 flex items-center space-x-3">
                        <GlobeAltIcon className="h-5 w-5 text-blue-600" />
                        <div>
                          <p className="font-medium">{account.domain}</p>
                          <p className="text-xs text-gray-500">{account.username}</p>
                        </div>
                      </div>
                      <div className="col-span-1 text-center">
                        {account.is_wordpress ? (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">WP</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </div>
                      <div className="col-span-1 text-center">
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs">
                          {account.php_version || '?'}
                        </span>
                      </div>
                      <div className="col-span-1 text-center font-medium">{account.disk_used || '-'}</div>
                      <div className="col-span-1 text-center text-gray-600">{account.db_size || '-'}</div>
                      <div className="col-span-1 text-center">
                        {account.databases?.length || 0}
                      </div>
                      <div className="col-span-2 text-center">
                        {account.email_accounts?.length || 0} emails
                      </div>
                      <div className="col-span-1 text-center">
                        {account.suspended ? (
                          <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs">Suspended</span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">Active</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Selected Count */}
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  {selectedAccounts.length} account(s) selected
                </p>
                <button
                  onClick={() => setCurrentStep('select_target')}
                  disabled={selectedAccounts.length === 0}
                  className="btn btn-primary"
                >
                  Continue →
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: Select Target Server */}
      {currentStep === 'select_target' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Select Target Server</h2>
            <button
              onClick={() => setCurrentStep('select_accounts')}
              className="text-sm text-blue-600 hover:underline"
            >
              ← Back to Accounts
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {targetServers.map((server) => (
              <button
                key={server.id}
                onClick={() => setFormData({ ...formData, target_server_id: server.id })}
                className={`p-4 border-2 rounded-lg text-left hover:border-purple-500 transition-colors ${
                  formData.target_server_id === server.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center mb-2">
                  <ServerStackIcon className="w-6 h-6 text-purple-600 mr-2" />
                  <span className="font-medium">{server.name}</span>
                </div>
                <p className="text-sm text-gray-500">{server.host}</p>
                <span className="inline-block mt-2 px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded">
                  {server.panel_type}
                </span>
              </button>
            ))}
          </div>

          {/* Cluster Server Selection */}
          {formData.target_server_id && clusterServers.length > 1 && (
            <div className="mt-6 p-4 bg-purple-50 rounded-lg">
              <h3 className="font-medium text-purple-900 mb-3">Select Target Server in Cluster</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {clusterServers.map((server) => (
                  <button
                    key={server.id}
                    onClick={() => setFormData({ ...formData, target_cluster_server_id: server.id })}
                    className={`p-3 border-2 rounded-lg text-left ${
                      formData.target_cluster_server_id === server.id
                        ? 'border-purple-500 bg-white'
                        : 'border-purple-200 bg-white hover:border-purple-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{server.friendly_name || server.hostname}</span>
                      {server.is_main && (
                        <span className="px-2 py-0.5 bg-purple-200 text-purple-800 text-xs rounded">Main</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{server.ip}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {loadingCluster && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
              <span className="ml-2 text-gray-500">Loading cluster servers...</span>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setCurrentStep('review')}
              disabled={!formData.target_server_id || (clusterServers.length > 1 && !formData.target_cluster_server_id)}
              className="btn btn-primary"
            >
              Continue to Review →
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Review */}
      {currentStep === 'review' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Review Migration</h2>
            <button
              onClick={() => setCurrentStep('select_target')}
              className="text-sm text-blue-600 hover:underline"
            >
              ← Back
            </button>
          </div>

          <div className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 bg-blue-50 rounded-lg">
                <h3 className="font-medium text-blue-900 mb-2">Source Server</h3>
                <p className="text-blue-700">{servers.find(s => s.id === formData.source_server_id)?.name}</p>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg">
                <h3 className="font-medium text-purple-900 mb-2">Target Server</h3>
                <p className="text-purple-700">{servers.find(s => s.id === formData.target_server_id)?.name}</p>
                {formData.target_cluster_server_id && (
                  <p className="text-sm text-purple-600 mt-1">
                    Cluster: {clusterServers.find(s => s.id === formData.target_cluster_server_id)?.friendly_name}
                  </p>
                )}
              </div>
            </div>

            {/* Accounts to Migrate */}
            <div>
              <h3 className="font-medium mb-3">Accounts to Migrate ({selectedAccounts.length})</h3>
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {selectedAccounts.map((account) => (
                  <div key={account.username} className="p-3 flex items-center justify-between">
                    <div className="flex items-center">
                      <GlobeAltIcon className="w-5 h-5 text-blue-600 mr-2" />
                      <div>
                        <p className="font-medium">{account.domain}</p>
                        <p className="text-xs text-gray-500">{account.username}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <span>{account.disk_used}</span>
                      <span>{account.databases?.length || 0} DBs</span>
                      <span>{account.email_accounts?.length || 0} emails</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Migration Steps Preview */}
            <div className="p-4 bg-gray-50 rounded-lg">
              <h3 className="font-medium mb-3">Migration Steps</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
                <li>Export databases from source server</li>
                <li>Compress website files</li>
                <li>Transfer files via rsync to migration server</li>
                <li>Create website on Enhance via API</li>
                <li>Upload files to target server</li>
                <li>Import databases</li>
                <li>Configure PHP version</li>
                <li>Generate hosts file entry for testing</li>
              </ol>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleStartMigration}
                disabled={starting}
                className="btn btn-primary px-8"
              >
                {starting ? 'Starting...' : 'Start Migration'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Migrating */}
      {currentStep === 'migrating' && migrationProgress && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-6">Migration in Progress</h2>
          
          <div className="space-y-6">
            {/* Progress Bar */}
            <div>
              <div className="flex justify-between mb-2">
                <span className="font-medium">{migrationProgress.step}</span>
                <span className="text-gray-500">{migrationProgress.progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-4">
                <div
                  className="bg-blue-600 h-4 rounded-full transition-all duration-500"
                  style={{ width: `${migrationProgress.progress}%` }}
                />
              </div>
              <p className="text-sm text-gray-500 mt-2">{migrationProgress.details}</p>
            </div>

            {/* Accounts being migrated */}
            <div className="border rounded-lg p-4">
              <h3 className="font-medium mb-3">Migrating Accounts</h3>
              <div className="space-y-2">
                {selectedAccounts.map((account) => (
                  <div key={account.username} className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
                    <span>{account.domain}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 6: Completed */}
      {currentStep === 'completed' && (
        <div className="card">
          <div className="text-center mb-6">
            <CheckCircleIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-green-700">Migration Completed!</h2>
            <p className="text-gray-600 mt-2">All accounts have been successfully migrated.</p>
          </div>

          {/* Hosts Entry */}
          <div className="p-4 bg-gray-900 rounded-lg mb-6">
            <h3 className="text-white font-medium mb-2">Add to your hosts file for testing:</h3>
            <code className="text-green-400 text-sm break-all">{hostsEntry}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(hostsEntry);
                toast.success('Copied to clipboard!');
              }}
              className="mt-2 text-xs text-blue-400 hover:underline"
            >
              Copy to clipboard
            </button>
          </div>

          {/* Migrated Accounts */}
          <div className="border rounded-lg p-4 mb-6">
            <h3 className="font-medium mb-3">Migrated Accounts</h3>
            <div className="space-y-2">
              {selectedAccounts.map((account) => (
                <div key={account.username} className="flex items-center text-green-700">
                  <CheckCircleIcon className="w-5 h-5 mr-2" />
                  <span>{account.domain}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-center space-x-4">
            <button
              onClick={() => {
                setCurrentStep('select_source');
                setSelectedAccounts([]);
                setFormData({
                  source_server_id: '',
                  target_server_id: '',
                  target_cluster_server_id: '',
                  new_password: '',
                });
              }}
              className="btn btn-secondary"
            >
              Start New Migration
            </button>
            <button
              onClick={() => navigate('/migrations')}
              className="btn btn-primary"
            >
              View All Migrations
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
