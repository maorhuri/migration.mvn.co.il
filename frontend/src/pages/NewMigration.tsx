import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ArrowPathIcon, ArrowRightIcon, MagnifyingGlassIcon } from '@heroicons/react/16/solid';
import toast from 'react-hot-toast';
import { getServers, getServerAccounts, getClusterServers, getExistingDomains, type ClusterServer, startMigration, getMigration, getMigrationLogs, refreshServerAccounts, submitScanDecision } from '../api/client';
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
  Mono,
  PageHeader,
  SkeletonTable,
  Stepper,
  type Step,
} from '../components/ui';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';
import { formatBytes, parseSizeToBytes } from '../lib/format';
import { isAgentlessPanel } from '../lib/agentless';
import { ServerPicker } from '../components/newmigration/ServerPicker';
import { ClusterNodePicker } from '../components/newmigration/ClusterNodePicker';
import { AccountsTable } from '../components/newmigration/AccountsTable';
import { SiteFactsCard } from '../components/newmigration/SiteFactsCard';
import { DatabasesModal, EmailAccountsModal } from '../components/newmigration/AccountListModals';
import { ReviewStep } from '../components/newmigration/ReviewStep';
import { MigrationProgress } from '../components/newmigration/MigrationProgress';
import { MigrationComplete } from '../components/newmigration/MigrationComplete';
import { ScanReportPanel } from '../components/migrations/ScanReportPanel';
import type { MigrationStep, MigrationStepStatus } from '../components/newmigration/types';

/** Wizard rail: ids are stable, labels and descriptions are translated at render time. */
const WIZARD_STEP_KEYS: { id: MigrationStep; key: string }[] = [
  { id: 'select_source', key: 'newmigration.wizard.source' },
  { id: 'select_target', key: 'newmigration.wizard.target' },
  { id: 'select_accounts', key: 'newmigration.wizard.accounts' },
  { id: 'review', key: 'newmigration.wizard.review' },
  { id: 'migrating', key: 'newmigration.wizard.migrate' },
];

const WIZARD_ORDER: MigrationStep[] = ['select_source', 'select_target', 'select_accounts', 'review', 'migrating'];

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

/** Steps an FTP / WordPress source never runs (no mailboxes or cron without root on the source). */
const AGENTLESS_SKIPPED_STEPS = new Set(['export_emails', 'export_cron']);

/** Step list for a run: the malware scan step only when the option is on; no mail / cron export for agentless sources. */
const buildSteps = (scan: boolean, agentless = false): MigrationStepStatus[] =>
  INITIAL_MIGRATION_STEPS.filter((st) => (scan || st.id !== 'scan_malware') && !(agentless && AGENTLESS_SKIPPED_STEPS.has(st.id)));

/** Up to this many accounts migrate at once; the rest wait their turn as a pool slot frees up. */
const MAX_CONCURRENT_MIGRATIONS = 5;

/** Independent progress state for one selected account's migration -- there is one of these per
 * selected account, updated by its own poll loop regardless of how many others are in flight. */
interface AccountRun {
  account: Account;
  migrationId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  steps: MigrationStepStatus[];
  currentStepIndex: number;
  overallProgress: number;
  logs: MigrationLog[];
  targetNode: string;
  targetIp: string;
  warnings: number;
  scanReview: ScanReport | null;
  startedAt: number | null;
}

/** Runs `worker` over `items` with at most `limit` in flight at once, returning results in the
 * original order. A slot picks up the next queued item as soon as it frees up. */
async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

export default function NewMigration() {
  const t = useT();
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
  // Suspended source accounts were already migrated (the operator suspends after the IP switch): hidden by default.
  const [showSuspended, setShowSuspended] = useState(false);
  // Accounts already migrated to the chosen target (any domain/alias already hosted there):
  // hidden by default, same as suspended source accounts.
  const [showMigrated, setShowMigrated] = useState(false);
  const [existingDomains, setExistingDomains] = useState<string[]>([]);
  const [loadingExistingDomains, setLoadingExistingDomains] = useState(false);
  const [sourceSearchTerm, setSourceSearchTerm] = useState('');
  const [sourceFilterType, setSourceFilterType] = useState<string>('all');
  const [targetSearchTerm, setTargetSearchTerm] = useState('');
  const [targetFilterType, setTargetFilterType] = useState<string>('all');
  const [clusterSearchTerm, setClusterSearchTerm] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<Account[]>([]);
  const [hostsEntry, setHostsEntry] = useState<string>('');
  const [warningLogs, setWarningLogs] = useState<MigrationLog[]>([]);
  const [warningCount, setWarningCount] = useState(0);
  const [sortField, setSortField] = useState<string>('domain');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [refreshingAccounts, setRefreshingAccounts] = useState(false);
  const [emailModalAccount, setEmailModalAccount] = useState<Account | null>(null);
  const [dbModalAccount, setDbModalAccount] = useState<Account | null>(null);

  // One entry per selected account, driven independently by its own poll loop -- up to
  // MAX_CONCURRENT_MIGRATIONS run at once instead of waiting for each to finish in turn.
  const [runs, setRuns] = useState<AccountRun[]>([]);
  // Kept in sync with `runs` on every update (no stale-closure risk) so the pool's completion
  // handler can read the final state without waiting on a re-render.
  const runsRef = useRef<AccountRun[]>([]);
  // Username of the run shown in the detailed panel; null lets it auto-follow the first to start.
  const [focusedUsername, setFocusedUsername] = useState<string | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  // Ticks once a second while running so each run's live elapsed time (now - run.startedAt) recomputes.
  const [now, setNow] = useState(() => Date.now());
  // Wall-clock span of the whole batch (first account started to last one finished), for the completion screen.
  const overallStartedAt = useRef<number | null>(null);
  const [finalElapsedMs, setFinalElapsedMs] = useState(0);
  // Ids of the migrations that completed in this run (links to the detail pages on the completion screen).
  const [completedMigrationIds, setCompletedMigrationIds] = useState<string[]>([]);

  const [formData, setFormData] = useState({
    source_server_id: '',
    target_server_id: '',
    target_cluster_server_id: '',
    scan_malware: false,
  });
  // FTP / WordPress source: one site, no mail / cron / DNS, and the old site is disabled by hand after DNS.
  const isAgentlessSource = isAgentlessPanel(servers.find((s: Server) => s.id === formData.source_server_id)?.panel_type);

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const data = await getServers();
        setServers(data);
      } catch (error) {
        toast.error(t('newmigration.toast.serversFailed'));
      } finally {
        setLoading(false);
      }
    };
    fetchServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // An agentless source holds exactly one site: it is the selection.
  useEffect(() => {
    if (isAgentlessSource && accounts.length === 1) setSelectedAccounts([accounts[0]]);
  }, [isAgentlessSource, accounts]);

  // Domains already hosted on the chosen target: fetched once the target (and, when it has
  // more than one node, the cluster server) is chosen, so the accounts step can hide them.
  useEffect(() => {
    if (!formData.target_server_id) {
      setExistingDomains([]);
      return;
    }
    // A multi-node target needs the node chosen first; a single-node one auto-selects it.
    if (clusterServers.length > 1 && !formData.target_cluster_server_id) {
      setExistingDomains([]);
      return;
    }
    let cancelled = false;
    setLoadingExistingDomains(true);
    getExistingDomains(formData.target_server_id, formData.target_cluster_server_id || undefined)
      .then((domains) => {
        if (!cancelled) setExistingDomains(domains);
      })
      .catch(() => {
        if (!cancelled) setExistingDomains([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingExistingDomains(false);
      });
    return () => {
      cancelled = true;
    };
  }, [formData.target_server_id, formData.target_cluster_server_id, clusterServers.length]);

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

  // Elapsed-time ticker: each run computes its own live duration from `now - run.startedAt`
  // (runs start at staggered times, so there is no single shared clock while running).
  useEffect(() => {
    if (!starting) return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [starting]);

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

  /** Patches one run in place (by username) and keeps runsRef in sync for the pool's completion handler. */
  const patchRun = (username: string, fn: (r: AccountRun) => AccountRun) => {
    setRuns((prev) => {
      const next = prev.map((r) => (r.account.username === username ? fn(r) : r));
      runsRef.current = next;
      return next;
    });
  };

  /** Runs one account's migration end-to-end (start + poll to completion), updating only its own
   * entry in `runs` (the authoritative final state read back from runsRef once the pool settles).
   * Independent of every other concurrently-running account. */
  const runOneAccount = async (account: Account, steps: MigrationStepStatus[]): Promise<void> => {
    const username = account.username;
    // Per-step wall-clock timestamps, local to this run (was a shared ref before; each run needs its own).
    const stepStartedAt: Record<number, number> = {};
    const stepEndedAt: Record<number, number> = {};
    const stepIndexOf = (id: string) => steps.findIndex((st) => st.id === id);

    const updateStep = (stepIndex: number, status: MigrationStepStatus['status'], error?: string, duration?: number) => {
      if (stepIndex < 0) return;
      if (status === 'running' && stepStartedAt[stepIndex] === undefined) {
        stepStartedAt[stepIndex] = Date.now();
      }
      if ((status === 'completed' || status === 'error') && duration === undefined) {
        const start = stepStartedAt[stepIndex];
        if (start !== undefined) {
          const end = stepEndedAt[stepIndex] ?? Date.now();
          stepEndedAt[stepIndex] = end;
          duration = Math.round((end - start) / 1000);
        }
      }
      patchRun(username, (r) => ({ ...r, steps: r.steps.map((step, idx) => (idx === stepIndex ? { ...step, status, error, duration } : step)) }));
    };

    let migration;
    try {
      migration = await startMigration({
        source_server_id: formData.source_server_id,
        target_server_id: formData.target_server_id,
        target_cluster_server_id: formData.target_cluster_server_id || undefined,
        username: account.username,
        scan_malware: formData.scan_malware,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      updateStep(0, 'error', errorMessage);
      patchRun(username, (r) => ({ ...r, status: 'failed' }));
      return;
    }

    patchRun(username, (r) => ({ ...r, migrationId: migration.id, status: 'running', startedAt: Date.now() }));
    setFocusedUsername((prev) => prev ?? username); // the first run to start becomes the focused panel

    try {
      let completed = false;
      const startTime = Date.now();
      let lastStepIndex = -1;
      updateStep(0, 'running');

      while (!completed) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every 1 second

        try {
          const status = await getMigration(migration.id);
          // Keep this run's own log panel current alongside its status (fire-and-forget: a
          // failed fetch just leaves last-known lines showing, same as the single-run version did).
          getMigrationLogs(migration.id)
            .then((logs) => patchRun(username, (r) => ({ ...r, logs })))
            .catch(() => {});

          if (status.target_ip) {
            const label = status.target_node ? `${status.target_node} (${status.target_ip})` : status.target_ip;
            patchRun(username, (r) => ({ ...r, targetNode: label, targetIp: status.target_ip! }));
          }

          // Map backend step names to UI step indices
          const currentStepName = status.current_step || '';
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
            patchRun(username, (r) => (r.scanReview ? r : { ...r, scanReview: status.scan_report! }));
            const scanIdx = stepIndexOf('scan_malware');
            if (scanIdx >= 0) {
              patchRun(username, (r) => ({
                ...r,
                steps: r.steps.map((st, idx) =>
                  idx === scanIdx && st.status !== 'warning'
                    ? { ...st, status: 'warning', details: `${status.scan_report!.findings.length} finding(s): waiting for your decision` }
                    : st,
                ),
              }));
            }
          } else if (status.status === 'running') {
            patchRun(username, (r) => (r.scanReview ? { ...r, scanReview: null } : r));
          }

          // Update steps if we moved forward
          if (matchedStepIndex >= 0 && matchedStepIndex > lastStepIndex) {
            for (let i = 0; i < matchedStepIndex; i++) updateStep(i, 'completed');
            updateStep(matchedStepIndex, 'running');
            lastStepIndex = matchedStepIndex;
            patchRun(username, (r) => ({ ...r, currentStepIndex: matchedStepIndex, overallProgress: Math.round(((matchedStepIndex + 1) / steps.length) * 100) }));
          }

          if (status.status === 'completed') {
            completed = true;
            patchRun(username, (r) => ({ ...r, scanReview: null }));
            for (let i = 0; i < steps.length; i++) updateStep(i, 'completed');
            patchRun(username, (r) => ({ ...r, overallProgress: 100, status: 'completed', warnings: status.warnings || 0 }));
            try {
              const logs = await getMigrationLogs(migration.id);
              patchRun(username, (r) => ({ ...r, logs }));
            } catch (e) {
              console.error('Failed to load migration logs', e);
            }
          } else if (status.status === 'failed' || status.status === 'cancelled') {
            const errorMsg = status.error || t('newmigration.error.failed');

            // Determine which step failed based on lastStepIndex and error message
            let failedStep = lastStepIndex >= 0 ? lastStepIndex : 0;

            if (errorMsg.toLowerCase().includes('malware') && stepIndexOf('scan_malware') >= 0) {
              failedStep = stepIndexOf('scan_malware');
            } else if (errorMsg.toLowerCase().includes('import')) {
              // Export was successful, fail on appropriate import step
              const lower = errorMsg.toLowerCase();
              if (lower.includes('ssh') || lower.includes('node') || lower.includes('reachable')) {
                failedStep = stepIndexOf('connect_node');
              } else if (lower.includes('permission')) {
                failedStep = stepIndexOf('fix_permissions');
              } else if (lower.includes('database') || lower.includes('mysql')) {
                failedStep = stepIndexOf('import_db');
              } else if (lower.includes('email') || lower.includes('cron') || lower.includes('ssl')) {
                failedStep = stepIndexOf('import_emails');
              } else if (lower.includes('upload') || lower.includes('files')) {
                failedStep = stepIndexOf('import_files');
              } else {
                failedStep = stepIndexOf('create_website');
              }
            }

            // The failure cannot be earlier than the last step the backend reported: keep the heuristic
            // only when it points past what was observed (a connection error before the import started).
            failedStep = Math.max(failedStep, lastStepIndex);

            for (let i = 0; i < failedStep; i++) updateStep(i, 'completed');
            updateStep(failedStep, 'error', errorMsg);
            patchRun(username, (r) => ({ ...r, currentStepIndex: failedStep, overallProgress: Math.round((failedStep / steps.length) * 100) }));
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
          throw new Error(t('newmigration.error.timeout'));
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Mark the step that was running as failed — unless the poll loop already
      // marked a specific step with the error (keep that one).
      patchRun(username, (r) => {
        if (r.steps.some((step) => step.status === 'error')) return { ...r, status: 'failed' };
        const runningIndex = r.steps.findIndex((step) => step.status === 'running');
        const failedIndex = runningIndex >= 0 ? runningIndex : 0;
        return {
          ...r,
          status: 'failed',
          steps: r.steps.map((step, idx) => (idx === failedIndex ? { ...step, status: 'error', error: errorMessage } : step)),
        };
      });
    }
  };

  const handleStartMigration = async () => {
    if (selectedAccounts.length === 0) {
      toast.error(t('newmigration.toast.selectOne'));
      return;
    }

    // The step list of this run: every poll loop indexes into its own copy of this same list.
    const steps = buildSteps(formData.scan_malware, isAgentlessSource);
    setCurrentStep('migrating');
    setStarting(true);
    setWarningLogs([]);
    setWarningCount(0);
    setCompletedMigrationIds([]);
    setFocusedUsername(null);
    overallStartedAt.current = Date.now();
    setNow(Date.now());
    const initialRuns: AccountRun[] = selectedAccounts.map((account) => ({
      account,
      migrationId: null,
      status: 'queued',
      steps: steps.map((st) => ({ ...st })),
      currentStepIndex: 0,
      overallProgress: 0,
      logs: [],
      targetNode: '',
      targetIp: '',
      warnings: 0,
      scanReview: null,
      startedAt: null,
    }));
    setRuns(initialRuns);
    runsRef.current = initialRuns;

    try {
      // Every run catches its own errors internally (see runOneAccount) rather than aborting
      // the rest of the batch -- one account failing should not stop the other 14 from trying.
      await runWithConcurrency(selectedAccounts, MAX_CONCURRENT_MIGRATIONS, (account) => runOneAccount(account, steps));

      const finalRuns = runsRef.current;
      const anyFailed = finalRuns.some((r) => r.status === 'failed');
      const succeeded = finalRuns.filter((r) => r.status === 'completed');

      const targetServer = servers.find((s: Server) => s.id === formData.target_server_id);
      // A DirectAdmin domain pointer is the account's real, customer-facing domain -- a.domain
      // alone is often just the internal hosting hostname it was provisioned under, which is
      // not what actually got registered as the website's domain on the target.
      const domains = selectedAccounts.map((a: Account) => a.pointers?.[0] || a.domain).join(' ');
      const anyTargetIp = finalRuns.find((r) => r.targetIp)?.targetIp;
      const hostsIP = anyTargetIp || clusterServers.find((c: ClusterServer) => c.id === formData.target_cluster_server_id)?.ip || targetServer?.host || 'TARGET_IP';
      setHostsEntry(`${hostsIP} ${domains}`);
      setWarningCount(finalRuns.reduce((sum, r) => sum + r.warnings, 0));
      setCompletedMigrationIds(succeeded.map((r) => r.migrationId).filter((id): id is string => !!id));
      setWarningLogs(finalRuns.flatMap((r) => r.logs.filter((l) => l.level === 'warn')));
      setFinalElapsedMs(overallStartedAt.current ? Date.now() - overallStartedAt.current : 0);

      if (anyFailed) {
        // Mixed or all-failed batch: stay on the migrating step, which now shows every run's
        // final state (including the failed ones) rather than jumping to the all-succeeded
        // completion screen, which has no concept of a failure.
        const failedCount = finalRuns.length - succeeded.length;
        toast.error(t('newmigration.toast.someFailed', { count: failedCount, total: finalRuns.length }));
      } else {
        setCurrentStep('completed');
        toast.success(t('newmigration.toast.completed'));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(t('newmigration.toast.failed', { error: errorMessage }));
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
    // Exclude source server from target list; FTP / WordPress records are sources only.
    const notSource = s.id !== formData.source_server_id && !isAgentlessPanel(s.panel_type);
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
      toast.success(t('newmigration.toast.refreshed'));
    } catch (error) {
      toast.error(t('newmigration.toast.refreshFailed'));
    } finally {
      setRefreshingAccounts(false);
    }
  };

  const suspendedCount = accounts.filter((acc: Account) => acc.suspended).length;
  const existingDomainsSet = new Set(existingDomains.map((d) => d.toLowerCase()));
  // A migrated account's website on the target is registered under its domain pointer when it
  // has one (the real, customer-facing domain), not acc.domain (often just the internal hosting
  // hostname) -- so a repeat run must also match against acc.pointers, not acc.domain alone.
  const isAlreadyMigrated = (acc: Account) =>
    (!!acc.domain && existingDomainsSet.has(acc.domain.toLowerCase())) ||
    !!acc.pointers?.some((p) => existingDomainsSet.has(p.toLowerCase()));
  const migratedCount = existingDomainsSet.size > 0 ? accounts.filter(isAlreadyMigrated).length : 0;
  const filteredAccounts = accounts
    .filter((acc: Account) => showSuspended || !acc.suspended)
    .filter((acc: Account) => showMigrated || !isAlreadyMigrated(acc))
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
    setRuns([]);
    runsRef.current = [];
    setFocusedUsername(null);
    setWarningLogs([]);
    setWarningCount(0);
    overallStartedAt.current = null;
    setFinalElapsedMs(0);
    setCompletedMigrationIds([]);
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
  // The run currently awaiting an operator decision on its malware scan findings (if any --
  // with several accounts migrating at once, more than one could need review; the rest just wait).
  const pendingReview = runs.find((r) => r.scanReview);
  const submitDecision = async (action: 'clean' | 'skip' | 'abort') => {
    if (!pendingReview || !pendingReview.migrationId) return;
    const migrationId = pendingReview.migrationId;
    const username = pendingReview.account.username;
    setDecisionBusy(true);
    try {
      await submitScanDecision(migrationId, action);
      toast.success(action === 'clean' ? t('newmigration.toast.cleaning') : action === 'skip' ? t('newmigration.toast.skipping') : t('newmigration.toast.aborted'));
      if (action !== 'abort') patchRun(username, (r) => ({ ...r, scanReview: null }));
    } catch (error) {
      const msg = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || t('newmigration.toast.decisionFailed');
      toast.error(msg);
    } finally {
      setDecisionBusy(false);
    }
  };

  const migrationFailed = currentStep === 'migrating' && !starting && runs.some((r) => r.status === 'failed');
  const wizardIndex = currentStep === 'completed' ? WIZARD_ORDER.length - 1 : WIZARD_ORDER.indexOf(currentStep);
  const wizardCompletedUpTo = currentStep === 'completed' ? WIZARD_ORDER.length - 1 : wizardIndex - 1;
  const wizardNavigable = currentStep !== 'migrating' && currentStep !== 'completed';
  const canContinueToReview = !!formData.target_server_id && !(clusterServers.length > 1 && !formData.target_cluster_server_id);

  const wizardSteps: Step[] = WIZARD_STEP_KEYS.map((s) => ({ id: s.id, label: t(s.key), description: t(`${s.key}.desc`) }));

  // What the selection weighs: disk, databases and mailboxes of the chosen accounts (tray summary).
  const selectionSummary = useMemo(() => {
    const bytes = selectedAccounts.reduce((sum: number, a: Account) => sum + parseSizeToBytes(a.disk_used), 0);
    const databases = selectedAccounts.reduce((sum: number, a: Account) => sum + (a.databases?.length ?? 0), 0);
    const mailboxes = selectedAccounts.reduce((sum: number, a: Account) => sum + (a.email_accounts?.length ?? 0), 0);
    return { bytes, databases, mailboxes };
  }, [selectedAccounts]);

  const suspendedToggle = suspendedCount > 0 && (
    <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
      <span>{showSuspended ? t('newmigration.tray.suspendedShown', { count: suspendedCount }) : t('newmigration.tray.suspendedHidden', { count: suspendedCount })}</span>
      <span className="hidden sm:inline">{t('newmigration.tray.alreadyMigrated')}</span>
      <Button size="sm" variant="ghost" onClick={() => setShowSuspended((v) => !v)}>
        {showSuspended ? t('newmigration.tray.hide') : t('newmigration.tray.show')}
      </Button>
    </span>
  );

  // Accounts whose domain already exists on the chosen target (a repeat run for this source):
  // hidden by default, same idea as the suspended toggle but scoped to the target, not the source.
  const migratedToggle = migratedCount > 0 && (
    <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
      <span>{showMigrated ? t('newmigration.tray.onTargetShown', { count: migratedCount }) : t('newmigration.tray.onTargetHidden', { count: migratedCount })}</span>
      <Button size="sm" variant="ghost" onClick={() => setShowMigrated((v) => !v)} disabled={loadingExistingDomains}>
        {showMigrated ? t('newmigration.tray.hide') : t('newmigration.tray.show')}
      </Button>
    </span>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('newmigration.title')} description={t('newmigration.description')} />

      <Card className="py-4 motion-safe:animate-rise stagger [--i:1] sm:py-5">
        <Stepper
          steps={wizardSteps}
          current={wizardIndex}
          completedUpTo={wizardCompletedUpTo}
          running={currentStep === 'migrating' && starting}
          error={migrationFailed ? WIZARD_ORDER.length - 1 : null}
          onStepClick={wizardNavigable ? (index) => setCurrentStep(WIZARD_ORDER[index]) : undefined}
        />
      </Card>

      {/* Step 1: Select Source Server */}
      {currentStep === 'select_source' && (
        <div key={currentStep} className="motion-safe:animate-rise">
          <Card>
            <CardHeader
              actions={
                !loading ? (
                  <Badge tone="neutral" size="sm">
                    {t('units.servers', { count: servers.length })}
                  </Badge>
                ) : undefined
              }
            >
              <CardTitle>{t('newmigration.source.title')}</CardTitle>
              <CardDescription>{t('newmigration.source.description')}</CardDescription>
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
                setCurrentStep('select_target');
              }}
              search={sourceSearchTerm}
              onSearchChange={setSourceSearchTerm}
              filterType={sourceFilterType}
              onFilterTypeChange={setSourceFilterType}
              loading={loading}
              onAddServer={() => navigate('/servers')}
            />
          </Card>
        </div>
      )}

      {/* Step 2: Select Target Server */}
      {currentStep === 'select_target' && (
        <div key={currentStep} className="space-y-6 motion-safe:animate-rise">
          <Card>
            <CardHeader
              actions={
                <Button size="sm" variant="ghost" leftIcon={<ArrowLeftIcon className="flip-rtl" />} onClick={() => setCurrentStep('select_source')}>
                  {t('common.back')}
                </Button>
              }
            >
              <CardTitle>{t('newmigration.target.title')}</CardTitle>
              <CardDescription>{t('newmigration.target.pick')}</CardDescription>
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
                <Button variant="primary" rightIcon={<ArrowRightIcon className="flip-rtl" />} onClick={() => setCurrentStep('select_accounts')} disabled={!canContinueToReview}>
                  {t('newmigration.target.continue')}
                </Button>
              </CardFooter>
            )}
          </Card>

          {/* Cluster Server Selection (Enhance targets with more than one node) */}
          {formData.target_server_id && (loadingCluster || clusterServers.length > 1) && (
            <Card edge="violet" className="motion-safe:animate-rise">
              <CardHeader
                actions={
                  targetServer ? (
                    <Badge tone="violet" size="sm">
                      {targetServer.name}
                    </Badge>
                  ) : undefined
                }
              >
                <CardTitle>{t('newmigration.cluster.title')}</CardTitle>
                <CardDescription>{t('newmigration.cluster.description')}</CardDescription>
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
                <Button variant="primary" rightIcon={<ArrowRightIcon className="flip-rtl" />} onClick={() => setCurrentStep('select_accounts')} disabled={!canContinueToReview || loadingCluster}>
                  {t('newmigration.target.continue')}
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      )}

      {/* Step 3: Select Accounts */}
      {currentStep === 'select_accounts' && (
        <div key={currentStep} className="motion-safe:animate-rise">
          <Card flush>
            <CardHeader
              divided
              actions={
                <>
                  {!isAgentlessSource && (
                    <div className="w-56">
                      <Input
                        size="sm"
                        leftIcon={<MagnifyingGlassIcon />}
                        placeholder={t('newmigration.accounts.search')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        aria-label={t('newmigration.accounts.searchAria')}
                        disabled={loadingAccounts}
                      />
                    </div>
                  )}
                  <Button size="sm" variant="secondary" leftIcon={<ArrowPathIcon />} onClick={handleRefreshAccounts} loading={refreshingAccounts} disabled={loadingAccounts} title={t('newmigration.accounts.refreshTitle')}>
                    {t('newmigration.accounts.refresh')}
                  </Button>
                  <Button size="sm" variant="ghost" leftIcon={<ArrowLeftIcon className="flip-rtl" />} onClick={() => setCurrentStep('select_target')}>
                    {t('common.back')}
                  </Button>
                </>
              }
            >
              <CardTitle>{isAgentlessSource ? t('newmigration.site.title') : t('newmigration.accounts.title')}</CardTitle>
              <CardDescription>
                {isAgentlessSource ? (
                  t('newmigration.site.description')
                ) : sourceServer ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span>{t('newmigration.accounts.from', { name: sourceServer.name })}</span>
                    <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <Mono className="text-[13px]">{sourceServer.host}</Mono>
                  </span>
                ) : (
                  t('newmigration.accounts.pick')
                )}
              </CardDescription>
            </CardHeader>

            {loadingAccounts ? (
              <SkeletonTable rows={isAgentlessSource ? 2 : 8} columns={7} />
            ) : accounts.length === 0 ? (
              <EmptyState
                illustration="accounts"
                title={t('newmigration.accounts.empty.title')}
                description={isAgentlessSource ? t('newmigration.accounts.empty.description.agentless') : t('newmigration.accounts.empty.description')}
                action={
                  <Button variant="primary" leftIcon={<ArrowPathIcon />} onClick={handleRefreshAccounts} loading={refreshingAccounts}>
                    {t('newmigration.accounts.empty.action')}
                  </Button>
                }
                secondaryAction={
                  <Button variant="secondary" onClick={() => setCurrentStep('select_source')}>
                    {t('newmigration.accounts.changeServer')}
                  </Button>
                }
              />
            ) : isAgentlessSource ? (
              <div className="px-6 py-5">
                <SiteFactsCard account={accounts[0]} server={sourceServer} />
              </div>
            ) : filteredAccounts.length === 0 ? (
              <EmptyState
                illustration="search"
                title={t('newmigration.accounts.noMatch.title')}
                description={t.rich('newmigration.accounts.noMatch.description', { query: <Mono>{searchTerm}</Mono> })}
                action={
                  <Button variant="secondary" onClick={() => setSearchTerm('')}>
                    {t('newmigration.accounts.clearSearch')}
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-200 px-6 py-3 text-xs text-slate-500 dark:border-white/[0.08] dark:text-slate-400">
                <span>
                  {filteredAccounts.length !== accounts.length
                    ? t('newmigration.tray.shownOf', { count: filteredAccounts.length, total: accounts.length })
                    : t('newmigration.tray.shown', { count: filteredAccounts.length })}
                </span>
                {!isAgentlessSource && suspendedToggle}
                {!isAgentlessSource && migratedToggle}
                {selectedAccounts.length === 0 && !isAgentlessSource && (
                  <div className="ms-auto flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={handleSelectAllAccounts} disabled={filteredAccounts.length === 0}>
                      {t('common.selectAll')}
                    </Button>
                    <Button size="sm" variant="primary" rightIcon={<ArrowRightIcon className="flip-rtl" />} onClick={() => setCurrentStep('review')} disabled={selectedAccounts.length === 0}>
                      {t('common.continue')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>

          {!loadingAccounts && accounts.length > 0 && selectedAccounts.length > 0 && (
            <div
              className={cn(
                'sticky bottom-4 z-10 mx-auto mt-4 flex w-fit max-w-full flex-wrap items-center gap-2 rounded-full border border-slate-200/80 bg-white/90 py-1.5 pe-1.5 ps-4 shadow-pop backdrop-blur',
                'motion-safe:animate-rise dark:border-white/[0.08] dark:bg-slate-900/90 dark:shadow-pop-dark',
              )}
            >
              <span key={selectedAccounts.length} className="text-gradient-brand text-sm font-semibold tabular motion-safe:animate-scale-in">
                {t('newmigration.tray.selected', { count: selectedAccounts.length })}
              </span>
              <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">
                <Mono className="text-xs">{formatBytes(selectionSummary.bytes)}</Mono>
                <span aria-hidden="true"> · </span>
                {t('units.databases', { count: selectionSummary.databases })}
                <span aria-hidden="true"> · </span>
                {t('units.mailboxes', { count: selectionSummary.mailboxes })}
              </span>
              <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:block dark:bg-white/[0.1]" aria-hidden="true" />
              {!isAgentlessSource && (
                <Button size="sm" variant="ghost" onClick={handleSelectAllAccounts} disabled={filteredAccounts.length === 0}>
                  {allFilteredSelected ? t('common.deselectAll') : t('common.selectAll')}
                </Button>
              )}
              <Button variant="primary" rightIcon={<ArrowRightIcon className="flip-rtl" />} onClick={() => setCurrentStep('review')} disabled={selectedAccounts.length === 0} className="rounded-full">
                {t('common.continue')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Review */}
      {currentStep === 'review' && (
        <div key={currentStep} className="motion-safe:animate-rise">
          <ReviewStep
            sourceServer={sourceServer}
            targetServer={targetServer}
            targetNode={targetClusterNode}
            accounts={selectedAccounts}
            plan={buildSteps(formData.scan_malware, isAgentlessSource)}
            scanMalware={formData.scan_malware}
            onScanMalwareChange={(value) => setFormData({ ...formData, scan_malware: value })}
            starting={starting}
            onStart={handleStartMigration}
            onBack={() => setCurrentStep('select_accounts')}
          />
        </div>
      )}

      {/* Step 5: Migrating */}
      {currentStep === 'migrating' && (() => {
        const focusedRun = runs.find((r) => r.account.username === focusedUsername) ?? runs.find((r) => r.migrationId) ?? runs[0];
        const doneCount = runs.filter((r) => r.status === 'completed' || r.status === 'failed').length;
        const runTone = (status: AccountRun['status']) =>
          status === 'completed' ? 'success' : status === 'failed' ? 'danger' : status === 'running' ? 'brand' : 'neutral';
        return (
          <div key={currentStep} className="space-y-6 motion-safe:animate-rise">
            {pendingReview && pendingReview.scanReview && (
              <ScanReportPanel
                report={pendingReview.scanReview}
                decision={{
                  busy: decisionBusy,
                  onClean: () => submitDecision('clean'),
                  onSkip: () => submitDecision('skip'),
                  onAbort: () => submitDecision('abort'),
                }}
              />
            )}

            {runs.length > 1 && (
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="me-1 text-xs font-medium text-slate-500 dark:text-slate-400" dir="ltr">
                    {doneCount} / {runs.length}
                  </span>
                  {runs.map((run) => (
                    <button
                      key={run.account.username}
                      type="button"
                      disabled={run.status === 'queued'}
                      onClick={() => setFocusedUsername(run.account.username)}
                      className="rounded-full disabled:cursor-default"
                    >
                      <Badge
                        tone={runTone(run.status)}
                        size="sm"
                        mono
                        dot
                        pulse={run.status === 'running'}
                        className={run.account.username === focusedRun?.account.username ? 'ring-2 ring-offset-1' : undefined}
                      >
                        {run.account.pointers?.[0] || run.account.domain || run.account.username}
                      </Badge>
                    </button>
                  ))}
                </div>
              </Card>
            )}

            {focusedRun && (
              <MigrationProgress
                steps={focusedRun.steps}
                currentStepIndex={focusedRun.currentStepIndex}
                overallProgress={focusedRun.overallProgress}
                elapsedMs={focusedRun.startedAt ? now - focusedRun.startedAt : 0}
                running={focusedRun.status === 'running' || focusedRun.status === 'queued'}
                failed={focusedRun.status === 'failed'}
                logs={focusedRun.logs}
                accounts={[focusedRun.account]}
                activeAccount={focusedRun.account.username}
                targetNode={focusedRun.targetNode}
                sourceName={sourceServer?.name}
                targetName={targetClusterNode?.friendly_name || targetClusterNode?.hostname || targetServer?.name}
                onBackToReview={() => setCurrentStep('review')}
                onViewMigrations={() => navigate('/migrations')}
              />
            )}
          </div>
        );
      })()}

      {/* Step 6: Completed */}
      {currentStep === 'completed' && (
        <div key={currentStep} className="motion-safe:animate-rise">
          <MigrationComplete
            warningCount={warningCount}
            warningLogs={warningLogs}
            targetNode={runs.find((r) => r.targetNode)?.targetNode ?? ''}
            accounts={selectedAccounts}
            hostsEntry={hostsEntry}
            logs={runs.flatMap((r) => r.logs)}
            migrationIds={completedMigrationIds}
            agentlessSource={isAgentlessSource}
            elapsedMs={finalElapsedMs}
            onStartNew={handleResetWizard}
            onViewAll={() => navigate('/migrations')}
          />
        </div>
      )}

      <EmailAccountsModal account={emailModalAccount} onClose={() => setEmailModalAccount(null)} />
      <DatabasesModal account={dbModalAccount} onClose={() => setDbModalAccount(null)} />
    </div>
  );
}
