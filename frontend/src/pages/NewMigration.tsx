import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ArrowPathIcon, ArrowRightIcon, MagnifyingGlassIcon } from '@heroicons/react/16/solid';
import { MagnifyingGlassIcon as MagnifyingGlassOutlineIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { getServers, getServerAccounts, getClusterServers, type ClusterServer, startMigration, getMigration, getMigrationLogs, refreshServerAccounts, submitScanDecision } from '../api/client';
import type { Server, Account, MigrationLog, ScanReport } from '../types';
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  PageHeader,
  SkeletonTable,
  Stepper,
  type Step,
} from '../components/ui';
import { cn } from '../lib/cn';
import { ServerPicker } from '../components/newmigration/ServerPicker';
import { ClusterNodePicker } from '../components/newmigration/ClusterNodePicker';
import { AccountsTable } from '../components/newmigration/AccountsTable';
import { DatabasesModal, EmailAccountsModal } from '../components/newmigration/AccountListModals';
import { ReviewStep } from '../components/newmigration/ReviewStep';
import { MigrationProgress } from '../components/newmigration/MigrationProgress';
import { MigrationComplete } from '../components/newmigration/MigrationComplete';
import { ScanReportPanel } from '../components/migrations/ScanReportPanel';
import type { MigrationStep, MigrationStepStatus } from '../components/newmigration/types';

const WIZARD_STEPS: Step[] = [
  { id: 'select_source', label: 'Source' },
  { id: 'select_accounts', label: 'Accounts' },
  { id: 'select_target', label: 'Target' },
  { id: 'review', label: 'Review' },
  { id: 'migrating', label: 'Migrate' },
];

const WIZARD_ORDER: MigrationStep[] = ['select_source', 'select_accounts', 'select_target', 'review', 'migrating'];

const INITIAL_MIGRATION_STEPS: MigrationStepStatus[] = [
  // Export phase (from source)
  { id: 'export_domains', name: 'Export Domains', status: 'pending', details: 'Reading domain configuration...' },
  { id: 'export_db', name: 'Export Databases', status: 'pending', details: 'Dumping MySQL databases...' },
  { id: 'export_emails', name: 'Export Emails', status: 'pending', details: 'Backing up mailboxes...' },
  { id: 'export_cron', name: 'Export Cron Jobs', status: 'pending', details: 'Saving scheduled tasks...' },
  { id: 'export_files', name: 'Download Files', status: 'pending', details: 'Downloading website files...' },
  // Optional staging-server scan (removed from the list when the option is off)
  { id: 'scan_malware', name: 'Malware Scan', status: 'pending', details: 'Scanning the staged files and database dumps on the middle server...' },
  // Import phase (to target)
  { id: 'connect_node', name: 'Connect to Cluster Node', status: 'pending', details: 'Resolving the node IP and opening root SSH...' },
  { id: 'create_website', name: 'Create Website on Enhance', status: 'pending', details: 'Creating website on the selected cluster server...' },
  { id: 'import_files', name: 'Upload Files', status: 'pending', details: 'Uploading website files to the cluster node...' },
  { id: 'import_db', name: 'Import Databases', status: 'pending', details: 'Creating databases, importing dumps, updating wp-config...' },
  { id: 'import_emails', name: 'Import Emails, Cron & SSL', status: 'pending', details: 'Creating mailboxes, cron jobs and certificates...' },
  { id: 'fix_permissions', name: 'Fix Permissions', status: 'pending', details: 'Setting ownership and file permissions...' },
  { id: 'cleanup', name: 'Cleanup', status: 'pending', details: 'Removing temporary files...' },
];

/** Step list for a run: the malware scan step only when the option is on. */
const buildSteps = (scan: boolean): MigrationStepStatus[] => INITIAL_MIGRATION_STEPS.filter((st) => scan || st.id !== 'scan_malware');

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
  const [warningLogs, setWarningLogs] = useState<MigrationLog[]>([]);
  const [warningCount, setWarningCount] = useState(0);
  const [targetNode, setTargetNode] = useState<string>('');
  const [overallProgress, setOverallProgress] = useState(0);
  const [sortField, setSortField] = useState<string>('domain');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [refreshingAccounts, setRefreshingAccounts] = useState(false);
  const [emailModalAccount, setEmailModalAccount] = useState<Account | null>(null);
  const [dbModalAccount, setDbModalAccount] = useState<Account | null>(null);

  // Live console + elapsed time for the migrating step (polled alongside the status loop).
  const [activeMigrationId, setActiveMigrationId] = useState<string | null>(null);
  // Malware scan waiting for the operator's decision (clean / skip / abort).
  const [scanReview, setScanReview] = useState<{ id: string; report: ScanReport } | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [liveLogs, setLiveLogs] = useState<MigrationLog[]>([]);
  const [migrationStartedAt, setMigrationStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Username of the account whose migration is currently being polled (multi-account runs).
  const [activeAccount, setActiveAccount] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    source_server_id: '',
    target_server_id: '',
    target_cluster_server_id: '',
    scan_malware: false,
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

  // Poll the live log of the migration currently running (every 2s while running,
  // one final fetch when it stops). Cleared on completion/failure/unmount.
  const logPollingActive = currentStep === 'migrating' && starting;
  useEffect(() => {
    if (!activeMigrationId) return;
    let cancelled = false;
    const migrationId = activeMigrationId;
    const fetchLogs = async () => {
      try {
        const logs = await getMigrationLogs(migrationId);
        if (cancelled) return;
        setLiveLogs((prev: MigrationLog[]) => [...prev.filter((l: MigrationLog) => l.migration_id !== migrationId), ...logs]);
      } catch (e) {
        // keep the last good log lines
      }
    };
    fetchLogs();
    if (!logPollingActive) {
      return () => {
        cancelled = true;
      };
    }
    const interval = setInterval(fetchLogs, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeMigrationId, logPollingActive]);

  // Elapsed-time ticker for the migrating header.
  useEffect(() => {
    if (!migrationStartedAt || !starting) return;
    const tick = () => setElapsedMs(Date.now() - migrationStartedAt);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [migrationStartedAt, starting]);

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
    setMigrationSteps([...INITIAL_MIGRATION_STEPS]);
    setCurrentMigrationStep(0);
    setOverallProgress(0);
    setWarningLogs([]);
    setWarningCount(0);
    setTargetNode('');
    setLiveLogs([]);
    setActiveMigrationId(null);
    setActiveAccount(null);
    setElapsedMs(0);
    setMigrationStartedAt(Date.now());
    setScanReview(null);
    const steps = buildSteps(formData.scan_malware);
    let accumulatedWarnings = 0;
    let accumulatedTargetIP = '';

    try {
      // Start migration for each selected account
      for (const account of selectedAccounts) {
        // Call the real API to start migration
        const migration = await startMigration({
          source_server_id: formData.source_server_id,
          target_server_id: formData.target_server_id,
          target_cluster_server_id: formData.target_cluster_server_id || undefined,
          username: account.username,
          scan_malware: formData.scan_malware,
        });
        setActiveMigrationId(migration.id);
        setActiveAccount(account.username);
        // Each account runs the full step list from the top.
        setMigrationSteps([...INITIAL_MIGRATION_STEPS]);
        setCurrentMigrationStep(0);
        setOverallProgress(0);

        // Poll for migration status
        let completed = false;
        const startTime = Date.now();
        let lastStepIndex = -1;
        let lastTargetIP = '';

        // Start first step as running
        updateStepStatus(0, 'running');

        while (!completed) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Poll every 1 second

          try {
            const status = await getMigration(migration.id);
            if (status.target_ip) {
              lastTargetIP = status.target_ip;
              setTargetNode(status.target_node ? `${status.target_node} (${status.target_ip})` : status.target_ip);
            }

            // Update UI based on current step from backend
            const currentStepName = status.current_step || '';

            // Map backend step names to UI step indices
            const stepMapping: [string, string][] = [
              // Export phase
              ['Exporting domains', 'export_domains'],
              ['Exporting databases', 'export_db'],
              ['Exporting emails', 'export_emails'],
              ['Exporting cron', 'export_cron'],
              ['Exporting DNS', 'export_cron'],
              ['Exporting files', 'export_files'],
              ['Downloading files', 'export_files'],
              ['Export completed', 'export_files'],
              // Staging scan
              ['Scanning for malware', 'scan_malware'],
              ['Waiting for malware scan review', 'scan_malware'],
              ['Cleaning malware findings', 'scan_malware'],
              ['Malware scan reviewed', 'scan_malware'],
              // Import phase
              ['Starting import', 'connect_node'],
              ['Connecting to cluster node', 'connect_node'],
              ['Creating websites', 'create_website'],
              ['Creating website', 'create_website'],
              ['Uploading files', 'import_files'],
              ['Importing files', 'import_files'],
              ['Importing databases', 'import_db'],
              ['Registering WordPress', 'import_db'],
              ['WordPress cleanup', 'import_db'],
              ['Configuring PHP', 'import_db'],
              ['Importing email', 'import_emails'],
              ['Importing cron', 'import_emails'],
              ['Setting up SSL', 'import_emails'],
              ['Fixing file permissions', 'fix_permissions'],
              ['Fixing permissions', 'fix_permissions'],
              ['Cleaning up', 'cleanup'],
              ['Migration completed', 'cleanup'],
            ];
            const stepIndexOf = (id: string) => steps.findIndex((st) => st.id === id);

            // Find matching step and update UI
            let matchedStepIndex = -1;
            for (const [stepName, stepId] of stepMapping) {
              if (currentStepName.toLowerCase().includes(stepName.toLowerCase())) {
                matchedStepIndex = stepIndexOf(stepId);
                break;
              }
            }

            // Malware scan waiting for a decision: show the findings and hold the scan step.
            if (status.status === 'awaiting_review' && status.scan_report) {
              setScanReview((prev) => (prev && prev.id === migration.id ? prev : { id: migration.id, report: status.scan_report! }));
              const scanIdx = stepIndexOf('scan_malware');
              if (scanIdx >= 0) {
                setMigrationSteps((prev: MigrationStepStatus[]) => prev.map((st: MigrationStepStatus, idx: number) =>
                  idx === scanIdx && st.status !== 'warning'
                    ? { ...st, status: 'warning', details: `${status.scan_report!.findings.length} finding(s): waiting for your decision` }
                    : st
                ));
              }
            } else if (status.status === 'running') {
              setScanReview((prev) => (prev && prev.id === migration.id ? null : prev));
            }

            // Update steps if we moved forward
            if (matchedStepIndex >= 0 && matchedStepIndex > lastStepIndex) {
              // Mark all previous steps as completed
              for (let i = 0; i < matchedStepIndex; i++) {
                updateStepStatus(i, 'completed');
              }
              // Mark current step as running
              updateStepStatus(matchedStepIndex, 'running');
              lastStepIndex = matchedStepIndex;
              setCurrentMigrationStep(matchedStepIndex);
              setOverallProgress(Math.round(((matchedStepIndex + 1) / steps.length) * 100));
            }

            if (status.status === 'completed') {
              completed = true;
              setScanReview(null);
              // Mark all steps as completed
              for (let i = 0; i < steps.length; i++) {
                updateStepStatus(i, 'completed');
              }
              setOverallProgress(100);
              accumulatedWarnings += status.warnings || 0;
              setWarningCount(accumulatedWarnings);
              try {
                const logs = await getMigrationLogs(migration.id);
                const warns = logs.filter((l: MigrationLog) => l.level === 'warn');
                setWarningLogs((prev: MigrationLog[]) => [...prev, ...warns]);
              } catch (e) {
                console.error('Failed to load migration logs', e);
              }
              if (lastTargetIP) accumulatedTargetIP = lastTargetIP;
            } else if (status.status === 'failed' || status.status === 'cancelled') {
              const errorMsg = status.error || 'Migration failed';

              // Determine which step failed based on lastStepIndex and error message
              let failedStep = lastStepIndex >= 0 ? lastStepIndex : 0;

              if (errorMsg.toLowerCase().includes('malware') && stepIndexOf('scan_malware') >= 0) {
                failedStep = stepIndexOf('scan_malware');
              } else if (errorMsg.toLowerCase().includes('import')) {
                // Export was successful, fail on appropriate import step
                const lower = errorMsg.toLowerCase();
                if (lower.includes('ssh') || lower.includes('node') || lower.includes('reachable')) {
                  failedStep = stepIndexOf('connect_node'); // node connection
                } else if (lower.includes('permission')) {
                  failedStep = stepIndexOf('fix_permissions');
                } else if (lower.includes('database') || lower.includes('mysql')) {
                  failedStep = stepIndexOf('import_db');
                } else if (lower.includes('email') || lower.includes('cron') || lower.includes('ssl')) {
                  failedStep = stepIndexOf('import_emails');
                } else if (lower.includes('upload') || lower.includes('files')) {
                  failedStep = stepIndexOf('import_files');
                } else {
                  failedStep = stepIndexOf('create_website'); // website creation
                }
              }

              // Mark all steps before failed as completed
              for (let i = 0; i < failedStep; i++) {
                updateStepStatus(i, 'completed');
              }
              // Mark only the failed step with error
              updateStepStatus(failedStep, 'error', errorMsg);
              setCurrentMigrationStep(failedStep);
              setOverallProgress(Math.round((failedStep / steps.length) * 100));
              throw new Error(errorMsg);
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
      const hostsIP = accumulatedTargetIP || clusterServers.find((c: ClusterServer) => c.id === formData.target_cluster_server_id)?.ip || targetServer?.host || 'TARGET_IP';
      setHostsEntry(`${hostsIP} ${domains}`);

      setCurrentStep('completed');
      toast.success('Migration completed successfully!');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Mark the step that was running as failed — unless the poll loop already
      // marked a specific step with the error (keep that one).
      setMigrationSteps((prev: MigrationStepStatus[]) => {
        if (prev.some((step: MigrationStepStatus) => step.status === 'error')) return prev;
        const runningIndex = prev.findIndex((step: MigrationStepStatus) => step.status === 'running');
        const failedIndex = runningIndex >= 0 ? runningIndex : 0;
        return prev.map((step: MigrationStepStatus, idx: number) =>
          idx === failedIndex ? { ...step, status: 'error', error: errorMessage } : step
        );
      });
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

  // Sort and filter accounts
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleRefreshAccounts = async () => {
    if (!formData.source_server_id) return;
    setRefreshingAccounts(true);
    try {
      const data = await refreshServerAccounts(formData.source_server_id);
      setAccounts(data.accounts);
      toast.success('Accounts refreshed');
    } catch (error) {
      toast.error('Failed to refresh accounts');
    } finally {
      setRefreshingAccounts(false);
    }
  };

  const filteredAccounts = accounts
    .filter((acc: Account) =>
      acc.domain?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      acc.username?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a: Account, b: Account) => {
      let aVal: string | number = '';
      let bVal: string | number = '';

      switch (sortField) {
        case 'domain':
          aVal = a.domain || '';
          bVal = b.domain || '';
          break;
        case 'disk_usage':
          aVal = parseFloat(a.disk_used?.replace(/[^\d.]/g, '') || '0');
          bVal = parseFloat(b.disk_used?.replace(/[^\d.]/g, '') || '0');
          break;
        case 'db_size':
          aVal = parseFloat(a.db_size?.replace(/[^\d.]/g, '') || '0');
          bVal = parseFloat(b.db_size?.replace(/[^\d.]/g, '') || '0');
          break;
        case 'php_version':
          aVal = a.php_version || '';
          bVal = b.php_version || '';
          break;
        case 'db_count':
          aVal = a.databases?.length || 0;
          bVal = b.databases?.length || 0;
          break;
        case 'email_count':
          aVal = a.email_accounts?.length || 0;
          bVal = b.email_accounts?.length || 0;
          break;
        default:
          aVal = a.domain || '';
          bVal = b.domain || '';
      }

      if (typeof aVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal);
      }
      return sortDirection === 'asc' ? aVal - (bVal as number) : (bVal as number) - aVal;
    });

  const filteredClusterServers = clusterServers.filter((server: ClusterServer) =>
    server.friendly_name?.toLowerCase().includes(clusterSearchTerm.toLowerCase()) ||
    server.hostname?.toLowerCase().includes(clusterSearchTerm.toLowerCase()) ||
    server.ip?.toLowerCase().includes(clusterSearchTerm.toLowerCase())
  );

  const handleResetWizard = () => {
    setCurrentStep('select_source');
    setSelectedAccounts([]);
    setMigrationSteps([]);
    setOverallProgress(0);
    setWarningLogs([]);
    setWarningCount(0);
    setTargetNode('');
    setLiveLogs([]);
    setActiveMigrationId(null);
    setActiveAccount(null);
    setMigrationStartedAt(null);
    setElapsedMs(0);
    setFormData({
      source_server_id: '',
      target_server_id: '',
      target_cluster_server_id: '',
      scan_malware: false,
    });
  };

  // ---- Presentation helpers (derived, no side effects) ----
  const sourceServer = servers.find((s: Server) => s.id === formData.source_server_id);
  const targetServer = servers.find((s: Server) => s.id === formData.target_server_id);
  const targetClusterNode = clusterServers.find((s: ClusterServer) => s.id === formData.target_cluster_server_id);
  const selectedUsernames = new Set(selectedAccounts.map((a: Account) => a.username));
  const allFilteredSelected = filteredAccounts.length > 0 && selectedAccounts.length === filteredAccounts.length;
  const submitDecision = async (action: 'clean' | 'skip' | 'abort') => {
    if (!scanReview) return;
    setDecisionBusy(true);
    try {
      await submitScanDecision(scanReview.id, action);
      toast.success(action === 'clean' ? 'Cleaning the staging copy, then continuing' : action === 'skip' ? 'Continuing without cleaning' : 'Migration aborted');
      if (action !== 'abort') setScanReview(null);
    } catch (error) {
      const msg = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to submit the decision';
      toast.error(msg);
    } finally {
      setDecisionBusy(false);
    }
  };

  const migrationFailed = currentStep === 'migrating' && !starting && migrationSteps.some((s: MigrationStepStatus) => s.status === 'error');
  const wizardIndex = currentStep === 'completed' ? WIZARD_ORDER.length - 1 : WIZARD_ORDER.indexOf(currentStep);
  const wizardCompletedUpTo = currentStep === 'completed' ? WIZARD_ORDER.length - 1 : wizardIndex - 1;
  const wizardNavigable = currentStep !== 'migrating' && currentStep !== 'completed';
  const canContinueToReview = !!formData.target_server_id && !(clusterServers.length > 1 && !formData.target_cluster_server_id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New migration"
        description="Move hosting accounts from one server to another: export from the source, recreate on the target, verify."
      />

      <Card className="py-4 sm:py-5">
        <Stepper
          steps={WIZARD_STEPS}
          current={wizardIndex}
          completedUpTo={wizardCompletedUpTo}
          running={currentStep === 'migrating' && starting}
          error={migrationFailed ? WIZARD_ORDER.length - 1 : null}
          onStepClick={wizardNavigable ? (index) => setCurrentStep(WIZARD_ORDER[index]) : undefined}
        />
      </Card>

      {/* Step 1: Select Source Server */}
      {currentStep === 'select_source' && (
        <Card>
          <CardHeader
            actions={
              !loading ? (
                <Badge tone="neutral" size="sm">
                  {servers.length} server{servers.length === 1 ? '' : 's'}
                </Badge>
              ) : undefined
            }
          >
            <CardTitle>Choose the source server</CardTitle>
            <CardDescription>Accounts are read from this server. Selecting one takes you to the account list.</CardDescription>
          </CardHeader>
          <ServerPicker
            servers={sourceServers}
            totalCount={servers.length}
            selectedId={formData.source_server_id}
            onSelect={(server) => {
              const changed = server.id !== formData.source_server_id;
              setFormData({
                ...formData,
                source_server_id: server.id,
                // A server cannot be both source and target.
                ...(server.id === formData.target_server_id ? { target_server_id: '', target_cluster_server_id: '' } : {}),
              });
              if (changed) {
                // The previous selection belonged to another server's account list.
                setSelectedAccounts([]);
                setSearchTerm('');
              }
              setCurrentStep('select_accounts');
            }}
            search={sourceSearchTerm}
            onSearchChange={setSourceSearchTerm}
            filterType={sourceFilterType}
            onFilterTypeChange={setSourceFilterType}
            loading={loading}
            onAddServer={() => navigate('/servers')}
          />
        </Card>
      )}

      {/* Step 2: Select Accounts */}
      {currentStep === 'select_accounts' && (
        <Card flush>
          <CardHeader
            divided
            actions={
              <>
                <div className="w-56">
                  <Input
                    size="sm"
                    leftIcon={<MagnifyingGlassIcon />}
                    placeholder="Search domain or username…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    aria-label="Search accounts"
                    disabled={loadingAccounts}
                  />
                </div>
                <Button size="sm" variant="secondary" leftIcon={<ArrowPathIcon />} onClick={handleRefreshAccounts} loading={refreshingAccounts} disabled={loadingAccounts} title="Reload the account list from the server">
                  Refresh
                </Button>
                <Button size="sm" variant="ghost" leftIcon={<ArrowLeftIcon />} onClick={() => setCurrentStep('select_source')}>
                  Change server
                </Button>
              </>
            }
          >
            <CardTitle>Select accounts to migrate</CardTitle>
            <CardDescription>
              {sourceServer ? (
                <>
                  From <span className="font-medium text-slate-700 dark:text-slate-300">{sourceServer.name}</span>
                  <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
                  <span className="font-mono text-[13px]">{sourceServer.host}</span>
                </>
              ) : (
                'Pick the accounts to move to the target server.'
              )}
            </CardDescription>
          </CardHeader>

          {loadingAccounts ? (
            <SkeletonTable rows={8} columns={7} />
          ) : accounts.length === 0 ? (
            <EmptyState
              icon={UserGroupIcon}
              title="No accounts found"
              description="The source server reported no hosting accounts, or the list could not be loaded. Try reloading it from the server."
              action={
                <Button variant="primary" leftIcon={<ArrowPathIcon />} onClick={handleRefreshAccounts} loading={refreshingAccounts}>
                  Refresh accounts
                </Button>
              }
              secondaryAction={
                <Button variant="secondary" onClick={() => setCurrentStep('select_source')}>
                  Change server
                </Button>
              }
            />
          ) : filteredAccounts.length === 0 ? (
            <EmptyState
              icon={MagnifyingGlassOutlineIcon}
              title="No accounts match"
              description={`Nothing matches "${searchTerm}". Try a different domain or username.`}
              action={
                <Button variant="secondary" onClick={() => setSearchTerm('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <AccountsTable
              accounts={filteredAccounts}
              selectedUsernames={selectedUsernames}
              allSelected={allFilteredSelected}
              onToggle={handleToggleAccount}
              onToggleAll={handleSelectAllAccounts}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              onShowEmails={setEmailModalAccount}
              onShowDatabases={setDbModalAccount}
            />
          )}

          {!loadingAccounts && accounts.length > 0 && (
            <div
              className={cn(
                'sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur',
                'dark:border-slate-800 dark:bg-slate-900/95 sm:px-6',
              )}
            >
              <div className="flex items-center gap-3 text-sm">
                <Badge tone={selectedAccounts.length > 0 ? 'brand' : 'neutral'} size="md">
                  {selectedAccounts.length} selected
                </Badge>
                <span className="text-slate-500 dark:text-slate-400">
                  of {filteredAccounts.length} shown{filteredAccounts.length !== accounts.length ? ` (${accounts.length} total)` : ''}
                </span>
                <Button size="sm" variant="ghost" onClick={handleSelectAllAccounts} disabled={filteredAccounts.length === 0}>
                  {allFilteredSelected ? 'Deselect all' : 'Select all'}
                </Button>
              </div>
              <Button variant="primary" rightIcon={<ArrowRightIcon />} onClick={() => setCurrentStep('select_target')} disabled={selectedAccounts.length === 0}>
                Continue
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Step 3: Select Target Server */}
      {currentStep === 'select_target' && (
        <div className="space-y-6">
          <Card>
            <CardHeader
              actions={
                <Button size="sm" variant="ghost" leftIcon={<ArrowLeftIcon />} onClick={() => setCurrentStep('select_accounts')}>
                  Back to accounts
                </Button>
              }
            >
              <CardTitle>Choose the target server</CardTitle>
              <CardDescription>
                {selectedAccounts.length} account{selectedAccounts.length === 1 ? '' : 's'} will be created here. The source server is excluded from the list.
              </CardDescription>
            </CardHeader>
            <ServerPicker
              servers={targetServers}
              totalCount={servers.filter((s: Server) => s.id !== formData.source_server_id).length}
              selectedId={formData.target_server_id}
              onSelect={(server) => setFormData({ ...formData, target_server_id: server.id })}
              search={targetSearchTerm}
              onSearchChange={setTargetSearchTerm}
              filterType={targetFilterType}
              onFilterTypeChange={setTargetFilterType}
              onAddServer={() => navigate('/servers')}
            />
            {!(formData.target_server_id && (loadingCluster || clusterServers.length > 1)) && (
              <CardFooter>
                <Button variant="primary" rightIcon={<ArrowRightIcon />} onClick={() => setCurrentStep('review')} disabled={!canContinueToReview}>
                  Continue to review
                </Button>
              </CardFooter>
            )}
          </Card>

          {/* Cluster Server Selection (Enhance targets with more than one node) */}
          {formData.target_server_id && (loadingCluster || clusterServers.length > 1) && (
            <Card accent="violet">
              <CardHeader
                actions={
                  targetServer ? (
                    <Badge tone="violet" size="sm">
                      {targetServer.name}
                    </Badge>
                  ) : undefined
                }
              >
                <CardTitle>Cluster node</CardTitle>
                <CardDescription>This Enhance cluster has several servers. Pick the node the website should be created on.</CardDescription>
              </CardHeader>
              <ClusterNodePicker
                nodes={filteredClusterServers}
                allNodes={clusterServers}
                selectedId={formData.target_cluster_server_id}
                onSelect={(node) => setFormData({ ...formData, target_cluster_server_id: node.id })}
                search={clusterSearchTerm}
                onSearchChange={setClusterSearchTerm}
                loading={loadingCluster}
              />
              <CardFooter>
                <Button variant="primary" rightIcon={<ArrowRightIcon />} onClick={() => setCurrentStep('review')} disabled={!canContinueToReview || loadingCluster}>
                  Continue to review
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      )}

      {/* Step 4: Review */}
      {currentStep === 'review' && (
        <ReviewStep
          sourceServer={sourceServer}
          targetServer={targetServer}
          targetNode={targetClusterNode}
          accounts={selectedAccounts}
          plan={buildSteps(formData.scan_malware)}
          scanMalware={formData.scan_malware}
          onScanMalwareChange={(value) => setFormData({ ...formData, scan_malware: value })}
          starting={starting}
          onStart={handleStartMigration}
          onBack={() => setCurrentStep('select_target')}
        />
      )}

      {/* Step 5: Migrating */}
      {currentStep === 'migrating' && scanReview && (
        <ScanReportPanel
          report={scanReview.report}
          decision={{
            busy: decisionBusy,
            onClean: () => submitDecision('clean'),
            onSkip: () => submitDecision('skip'),
            onAbort: () => submitDecision('abort'),
          }}
        />
      )}

      {currentStep === 'migrating' && (
        <MigrationProgress
          steps={migrationSteps}
          currentStepIndex={currentMigrationStep}
          overallProgress={overallProgress}
          elapsedMs={elapsedMs}
          running={starting}
          failed={migrationFailed}
          logs={liveLogs}
          accounts={selectedAccounts}
          activeAccount={activeAccount}
          targetNode={targetNode}
          onBackToReview={() => setCurrentStep('review')}
          onViewMigrations={() => navigate('/migrations')}
        />
      )}

      {/* Step 6: Completed */}
      {currentStep === 'completed' && (
        <MigrationComplete
          warningCount={warningCount}
          warningLogs={warningLogs}
          targetNode={targetNode}
          accounts={selectedAccounts}
          stepsCompleted={migrationSteps.filter((s: MigrationStepStatus) => s.status === 'completed').length}
          hostsEntry={hostsEntry}
          onStartNew={handleResetWizard}
          onViewAll={() => navigate('/migrations')}
        />
      )}

      <EmailAccountsModal account={emailModalAccount} onClose={() => setEmailModalAccount(null)} />
      <DatabasesModal account={dbModalAccount} onClose={() => setDbModalAccount(null)} />
    </div>
  );
}
