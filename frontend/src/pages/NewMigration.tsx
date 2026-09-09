import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircleIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  ServerStackIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { getServers, getServerAccounts, getClusterServers, ClusterServer, startMigration, getMigration, getMigrationLogs } from '../api/client';
import type { Server, Account } from '../types';

type MigrationStep = 'select_source' | 'select_accounts' | 'select_target' | 'review' | 'migrating' | 'completed';

interface MigrationStepStatus {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'warning';
  details?: string;
  error?: string;
  duration?: number;
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
  const [sourceSearchTerm, setSourceSearchTerm] = useState('');
  const [sourceFilterType, setSourceFilterType] = useState<string>('all');
  const [targetSearchTerm, setTargetSearchTerm] = useState('');
  const [targetFilterType, setTargetFilterType] = useState<string>('all');
  const [clusterSearchTerm, setClusterSearchTerm] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<Account[]>([]);
  const [migrationSteps, setMigrationSteps] = useState<MigrationStepStatus[]>([]);
  const [currentMigrationStep, setCurrentMigrationStep] = useState(0);
  const [hostsEntry, setHostsEntry] = useState<string>('');
  const [overallProgress, setOverallProgress] = useState(0);

  const [formData, setFormData] = useState({
    source_server_id: '',
    target_server_id: '',
    target_cluster_server_id: '',
    new_password: '',
  });

  const initialMigrationSteps: MigrationStepStatus[] = [
    // Export phase (from source)
    { id: 'export_domains', name: 'Export Domains', status: 'pending', details: 'Reading domain configuration...' },
    { id: 'export_db', name: 'Export Databases', status: 'pending', details: 'Dumping MySQL databases...' },
    { id: 'export_emails', name: 'Export Emails', status: 'pending', details: 'Backing up mailboxes...' },
    { id: 'export_cron', name: 'Export Cron Jobs', status: 'pending', details: 'Saving scheduled tasks...' },
    { id: 'export_files', name: 'Download Files', status: 'pending', details: 'Downloading website files...' },
    // Import phase (to target)
    { id: 'create_website', name: 'Create Website on Enhance', status: 'pending', details: 'Creating website via API...' },
    { id: 'import_db', name: 'Import Databases', status: 'pending', details: 'Restoring MySQL databases...' },
    { id: 'import_emails', name: 'Import Emails', status: 'pending', details: 'Creating email accounts...' },
    { id: 'import_files', name: 'Upload Files', status: 'pending', details: 'Uploading website files...' },
    { id: 'fix_permissions', name: 'Fix Permissions', status: 'pending', details: 'Setting file permissions...' },
    { id: 'cleanup', name: 'Cleanup', status: 'pending', details: 'Removing temporary files...' },
  ];

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
            setFormData((prev: typeof formData) => ({ ...prev, target_cluster_server_id: data[0].id }));
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
    if (selectedAccounts.find((a: Account) => a.username === account.username)) {
      setSelectedAccounts(selectedAccounts.filter((a: Account) => a.username !== account.username));
    } else {
      setSelectedAccounts([...selectedAccounts, account]);
    }
  };

  const updateStepStatus = (stepIndex: number, status: MigrationStepStatus['status'], error?: string, duration?: number) => {
    setMigrationSteps((prev: MigrationStepStatus[]) => prev.map((step: MigrationStepStatus, idx: number) => 
      idx === stepIndex ? { ...step, status, error, duration } : step
    ));
  };

  const handleStartMigration = async () => {
    if (selectedAccounts.length === 0) {
      toast.error('Please select at least one account');
      return;
    }

    setCurrentStep('migrating');
    setStarting(true);
    setMigrationSteps([...initialMigrationSteps]);
    setCurrentMigrationStep(0);
    setOverallProgress(0);

    try {
      // Start migration for each selected account
      for (const account of selectedAccounts) {
        // Call the real API to start migration
        const migration = await startMigration({
          source_server_id: formData.source_server_id,
          target_server_id: formData.target_server_id,
          username: account.username,
          new_password: formData.new_password || undefined,
        });

        // Poll for migration status
        let completed = false;
        const startTime = Date.now();

        while (!completed) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Poll every 2 seconds

          try {
            const status = await getMigration(migration.id);
            const logs = await getMigrationLogs(migration.id);

            // Update UI based on current step from backend
            const currentStepName = status.current_step || '';
            
            // Map backend step names to UI step indices
            const stepMapping: Record<string, number> = {
              // Export phase
              'Exporting domains': 0,
              'Exporting databases': 1,
              'Exporting emails': 2,
              'Exporting cron': 3,
              'Exporting files': 4,
              'Downloading files': 4,
              // Import phase
              'Creating websites': 5,
              'Creating website': 5,
              'Importing databases': 6,
              'Importing email': 7,
              'Importing files': 8,
              'Uploading files': 8,
              'Fixing file permissions': 9,
              'Fixing permissions': 9,
              'Cleaning up': 10,
              'Migration completed': 10,
            };

            // Find matching step and update UI
            let matchedStepIndex = -1;
            for (const [stepName, stepIndex] of Object.entries(stepMapping)) {
              if (currentStepName.toLowerCase().includes(stepName.toLowerCase())) {
                matchedStepIndex = stepIndex;
                break;
              }
            }

            if (matchedStepIndex >= 0 && matchedStepIndex !== currentMigrationStep) {
              // Mark previous steps as completed, current as running
              for (let i = 0; i <= matchedStepIndex; i++) {
                if (i < matchedStepIndex) {
                  updateStepStatus(i, 'completed');
                } else {
                  updateStepStatus(i, 'running');
                }
              }
              setCurrentMigrationStep(matchedStepIndex);
              setOverallProgress(Math.round(((matchedStepIndex + 1) / initialMigrationSteps.length) * 100));
            }

            if (status.status === 'completed') {
              completed = true;
              // Mark all steps as completed
              for (let i = 0; i < initialMigrationSteps.length; i++) {
                updateStepStatus(i, 'completed');
              }
              setOverallProgress(100);
            } else if (status.status === 'failed') {
              // Find which step failed based on the error message
              const errorMsg = status.error || 'Migration failed';
              let failedStep = currentMigrationStep;
              
              // Determine failed step from error message
              if (errorMsg.includes('export')) {
                if (errorMsg.includes('database')) failedStep = 1;
                else if (errorMsg.includes('email')) failedStep = 2;
                else if (errorMsg.includes('cron')) failedStep = 3;
                else if (errorMsg.includes('file')) failedStep = 4;
                else failedStep = 0;
              } else if (errorMsg.includes('import')) {
                if (errorMsg.includes('website') || errorMsg.includes('create')) failedStep = 5;
                else if (errorMsg.includes('database')) failedStep = 6;
                else if (errorMsg.includes('email')) failedStep = 7;
                else if (errorMsg.includes('file')) failedStep = 8;
                else failedStep = 5;
              }
              
              // Mark steps up to failed as completed, failed step as error
              for (let i = 0; i < failedStep; i++) {
                updateStepStatus(i, 'completed');
              }
              updateStepStatus(failedStep, 'error', errorMsg);
              setCurrentMigrationStep(failedStep);
              throw new Error(errorMsg);
            }

            // Check for errors in logs
            const errorLogs = logs.filter(log => log.level === 'error');
            if (errorLogs.length > 0) {
              const lastError = errorLogs[errorLogs.length - 1];
              // Don't throw immediately, let the status check handle it
              console.error('Migration error:', lastError.message);
            }

          } catch (pollError) {
            // If it's a network error, continue polling
            if (String(pollError).includes('Network')) {
              continue;
            }
            throw pollError;
          }

          // Timeout after 30 minutes
          if (Date.now() - startTime > 30 * 60 * 1000) {
            throw new Error('Migration timeout - please check the server logs');
          }
        }
      }

      // Generate hosts entry
      const targetServer = servers.find((s: Server) => s.id === formData.target_server_id);
      const domains = selectedAccounts.map((a: Account) => a.domain).join(' ');
      setHostsEntry(`${targetServer?.host || 'TARGET_IP'} ${domains}`);
      
      setCurrentStep('completed');
      toast.success('Migration completed successfully!');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      updateStepStatus(currentMigrationStep, 'error', errorMessage);
      toast.error('Migration failed: ' + errorMessage);
    } finally {
      setStarting(false);
    }
  };

  // All servers can be source or target
  const sourceServers = servers.filter((s: Server) => {
    const matchesSearch = s.name.toLowerCase().includes(sourceSearchTerm.toLowerCase()) ||
                          s.host.toLowerCase().includes(sourceSearchTerm.toLowerCase());
    const matchesType = sourceFilterType === 'all' || s.panel_type === sourceFilterType;
    return matchesSearch && matchesType;
  });

  const targetServers = servers.filter((s: Server) => {
    const matchesSearch = s.name.toLowerCase().includes(targetSearchTerm.toLowerCase()) ||
                          s.host.toLowerCase().includes(targetSearchTerm.toLowerCase());
    const matchesType = targetFilterType === 'all' || s.panel_type === targetFilterType;
    // Exclude source server from target list
    const notSource = s.id !== formData.source_server_id;
    return matchesSearch && matchesType && notSource;
  });

  const filteredAccounts = accounts.filter((acc: Account) =>
    acc.domain?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    acc.username?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredClusterServers = clusterServers.filter((server: ClusterServer) =>
    server.friendly_name?.toLowerCase().includes(clusterSearchTerm.toLowerCase()) ||
    server.hostname?.toLowerCase().includes(clusterSearchTerm.toLowerCase()) ||
    server.ip?.toLowerCase().includes(clusterSearchTerm.toLowerCase())
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Select Source Server</h2>
            <span className="text-sm text-gray-500">{servers.length} servers available</span>
          </div>

          {/* Search and Filter */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name or host..."
                value={sourceSearchTerm}
                onChange={(e) => setSourceSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-full focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <select
              value={sourceFilterType}
              onChange={(e) => setSourceFilterType(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              <option value="directadmin">DirectAdmin</option>
              <option value="enhance">Enhance</option>
              <option value="cpanel">cPanel</option>
              <option value="cloudpanel">CloudPanel</option>
            </select>
          </div>

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
                  <ServerStackIcon className={`w-6 h-6 mr-2 ${
                    server.panel_type === 'directadmin' ? 'text-blue-600' :
                    server.panel_type === 'enhance' ? 'text-purple-600' :
                    server.panel_type === 'cpanel' ? 'text-orange-600' : 'text-gray-600'
                  }`} />
                  <span className="font-medium">{server.name}</span>
                </div>
                <p className="text-sm text-gray-500">{server.host}</p>
                <span className={`inline-block mt-2 px-2 py-1 text-xs rounded ${
                  server.panel_type === 'directadmin' ? 'bg-blue-100 text-blue-700' :
                  server.panel_type === 'enhance' ? 'bg-purple-100 text-purple-700' :
                  server.panel_type === 'cpanel' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {server.panel_type}
                </span>
              </button>
            ))}
          </div>
          {sourceServers.length === 0 && (
            <p className="text-center text-gray-500 py-8">
              No servers match your search. Try adjusting your filters.
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
                        selectedAccounts.find((a: Account) => a.username === account.username) ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="col-span-1">
                        <input
                          type="checkbox"
                          checked={!!selectedAccounts.find((a: Account) => a.username === account.username)}
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

          {/* Search and Filter */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name or host..."
                value={targetSearchTerm}
                onChange={(e) => setTargetSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-full focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <select
              value={targetFilterType}
              onChange={(e) => setTargetFilterType(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            >
              <option value="all">All Types</option>
              <option value="directadmin">DirectAdmin</option>
              <option value="enhance">Enhance</option>
              <option value="cpanel">cPanel</option>
              <option value="cloudpanel">CloudPanel</option>
            </select>
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
                  <ServerStackIcon className={`w-6 h-6 mr-2 ${
                    server.panel_type === 'directadmin' ? 'text-blue-600' :
                    server.panel_type === 'enhance' ? 'text-purple-600' :
                    server.panel_type === 'cpanel' ? 'text-orange-600' : 'text-gray-600'
                  }`} />
                  <span className="font-medium">{server.name}</span>
                </div>
                <p className="text-sm text-gray-500">{server.host}</p>
                <span className={`inline-block mt-2 px-2 py-1 text-xs rounded ${
                  server.panel_type === 'directadmin' ? 'bg-blue-100 text-blue-700' :
                  server.panel_type === 'enhance' ? 'bg-purple-100 text-purple-700' :
                  server.panel_type === 'cpanel' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {server.panel_type}
                </span>
              </button>
            ))}
          </div>

          {targetServers.length === 0 && (
            <p className="text-center text-gray-500 py-4 mb-6">
              No servers match your search. Try adjusting your filters.
            </p>
          )}

          {/* Cluster Server Selection */}
          {formData.target_server_id && clusterServers.length > 1 && (
            <div className="mt-6 p-4 bg-purple-50 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-purple-900">Select Target Server in Cluster</h3>
                <span className="text-sm text-purple-600">{clusterServers.length} servers available</span>
              </div>
              
              {/* Cluster Search */}
              <div className="relative mb-4">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-purple-400" />
                <input
                  type="text"
                  placeholder="Search servers by name, hostname or IP..."
                  value={clusterSearchTerm}
                  onChange={(e) => setClusterSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-purple-200 rounded-lg w-full focus:ring-2 focus:ring-purple-500 bg-white"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto">
                {filteredClusterServers.map((server) => (
                  <button
                    key={server.id}
                    onClick={() => setFormData({ ...formData, target_cluster_server_id: server.id })}
                    className={`p-3 border-2 rounded-lg text-left transition-all ${
                      formData.target_cluster_server_id === server.id
                        ? 'border-purple-500 bg-white shadow-md'
                        : 'border-purple-200 bg-white hover:border-purple-400 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900 truncate">
                        {server.friendly_name || server.hostname}
                      </span>
                      {server.is_main && (
                        <span className="px-2 py-0.5 bg-purple-200 text-purple-800 text-xs rounded ml-2 flex-shrink-0">Main</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{server.ip}</p>
                    {server.hostname && server.hostname !== server.friendly_name && (
                      <p className="text-xs text-gray-400 truncate">{server.hostname}</p>
                    )}
                  </button>
                ))}
              </div>
              
              {filteredClusterServers.length === 0 && (
                <p className="text-center text-purple-600 py-4">No servers match your search</p>
              )}
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
                <p className="text-blue-700">{servers.find((s: Server) => s.id === formData.source_server_id)?.name}</p>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg">
                <h3 className="font-medium text-purple-900 mb-2">Target Server</h3>
                <p className="text-purple-700">{servers.find((s: Server) => s.id === formData.target_server_id)?.name}</p>
                {formData.target_cluster_server_id && (
                  <p className="text-sm text-purple-600 mt-1">
                    Cluster: {clusterServers.find((s: ClusterServer) => s.id === formData.target_cluster_server_id)?.friendly_name}
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
                <li>Export email accounts and mailboxes</li>
                <li>Export cron jobs (scheduled tasks)</li>
                <li>Compress website files</li>
                <li>Transfer files via rsync to migration server</li>
                <li>Create website on Enhance via API</li>
                <li>Upload files to target server</li>
                <li>Import databases</li>
                <li>Import email accounts and mailboxes</li>
                <li>Import cron jobs</li>
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

      {/* Step 5: Migrating - Professional Loader */}
      {currentStep === 'migrating' && (
        <div className="card">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Migration in Progress</h2>
            <p className="text-gray-600">Please wait while we migrate your accounts...</p>
          </div>

          {/* Overall Progress */}
          <div className="mb-8">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">Overall Progress</span>
              <span className="text-sm font-bold text-blue-600">{overallProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>

          {/* Steps List */}
          <div className="space-y-3">
            {migrationSteps.map((step, index) => (
              <div
                key={step.id}
                className={`p-4 rounded-lg border-2 transition-all duration-300 ${
                  step.status === 'running' ? 'border-blue-500 bg-blue-50 shadow-md' :
                  step.status === 'completed' ? 'border-green-300 bg-green-50' :
                  step.status === 'error' ? 'border-red-300 bg-red-50' :
                  step.status === 'warning' ? 'border-yellow-300 bg-yellow-50' :
                  'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {/* Status Icon */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      step.status === 'running' ? 'bg-blue-500' :
                      step.status === 'completed' ? 'bg-green-500' :
                      step.status === 'error' ? 'bg-red-500' :
                      step.status === 'warning' ? 'bg-yellow-500' :
                      'bg-gray-300'
                    }`}>
                      {step.status === 'running' ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : step.status === 'completed' ? (
                        <CheckCircleIcon className="w-5 h-5 text-white" />
                      ) : step.status === 'error' ? (
                        <XCircleIcon className="w-5 h-5 text-white" />
                      ) : step.status === 'warning' ? (
                        <ExclamationTriangleIcon className="w-5 h-5 text-white" />
                      ) : (
                        <span className="text-white text-sm font-medium">{index + 1}</span>
                      )}
                    </div>
                    
                    <div>
                      <p className={`font-medium ${
                        step.status === 'running' ? 'text-blue-900' :
                        step.status === 'completed' ? 'text-green-900' :
                        step.status === 'error' ? 'text-red-900' :
                        step.status === 'warning' ? 'text-yellow-900' :
                        'text-gray-500'
                      }`}>
                        {step.name}
                      </p>
                      {step.status === 'running' && (
                        <p className="text-sm text-blue-600">{step.details}</p>
                      )}
                      {step.status === 'error' && step.error && (
                        <p className="text-sm text-red-600 mt-1">
                          <span className="font-medium">Error:</span> {step.error}
                        </p>
                      )}
                      {step.status === 'warning' && step.error && (
                        <p className="text-sm text-yellow-700 mt-1">
                          <span className="font-medium">Warning:</span> {step.error}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Duration */}
                  {step.duration !== undefined && (
                    <span className="text-sm text-gray-500">{step.duration}s</span>
                  )}
                </div>

                {/* Running Animation Bar */}
                {step.status === 'running' && (
                  <div className="mt-3 w-full bg-blue-200 rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Accounts being migrated */}
          <div className="mt-8 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium mb-3 text-gray-700">Migrating Accounts</h3>
            <div className="flex flex-wrap gap-2">
              {selectedAccounts.map((account) => (
                <span
                  key={account.username}
                  className="px-3 py-1 bg-white border border-gray-200 rounded-full text-sm text-gray-700"
                >
                  {account.domain}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 6: Completed */}
      {currentStep === 'completed' && (
        <div className="card">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircleIcon className="w-12 h-12 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-green-700">Migration Completed!</h2>
            <p className="text-gray-600 mt-2">All accounts have been successfully migrated.</p>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <p className="text-3xl font-bold text-blue-600">{selectedAccounts.length}</p>
              <p className="text-sm text-blue-700">Accounts</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <p className="text-3xl font-bold text-green-600">
                {migrationSteps.filter((s: MigrationStepStatus) => s.status === 'completed').length}
              </p>
              <p className="text-sm text-green-700">Steps Completed</p>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <p className="text-3xl font-bold text-yellow-600">
                {migrationSteps.filter((s: MigrationStepStatus) => s.status === 'warning').length}
              </p>
              <p className="text-sm text-yellow-700">Warnings</p>
            </div>
          </div>

          {/* Hosts Entry */}
          <div className="p-4 bg-gray-900 rounded-lg mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-white font-medium">Add to your hosts file for testing:</h3>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(hostsEntry);
                  toast.success('Copied to clipboard!');
                }}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
              >
                Copy
              </button>
            </div>
            <code className="text-green-400 text-sm break-all font-mono">{hostsEntry}</code>
            <p className="text-gray-400 text-xs mt-2">
              File location: Windows: C:\Windows\System32\drivers\etc\hosts | Mac/Linux: /etc/hosts
            </p>
          </div>

          {/* Migrated Accounts */}
          <div className="border rounded-lg p-4 mb-6">
            <h3 className="font-medium mb-3">Migrated Accounts</h3>
            <div className="space-y-2">
              {selectedAccounts.map((account) => (
                <div key={account.username} className="flex items-center text-green-700">
                  <CheckCircleIcon className="w-5 h-5 mr-2" />
                  <span className="font-medium">{account.domain}</span>
                  <span className="text-gray-400 text-sm ml-2">({account.username})</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-center space-x-4">
            <button
              onClick={() => {
                setCurrentStep('select_source');
                setSelectedAccounts([]);
                setMigrationSteps([]);
                setOverallProgress(0);
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
