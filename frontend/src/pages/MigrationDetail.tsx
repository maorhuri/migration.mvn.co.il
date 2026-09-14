import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowPathIcon, PauseCircleIcon, PlayCircleIcon, StopIcon } from '@heroicons/react/20/solid';
import { ArrowsRightLeftIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { cancelMigration, getMigration, getMigrationLogs, getServer, submitScanDecision, suspendMigrationSource, unsuspendMigrationSource } from '../api/client';
import type { Migration, MigrationLog, Server } from '../types';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, CodeBlock, ConfirmDialog, EmptyState, LogViewer, PageHeader, Skeleton, SkeletonCard, StatusBadge } from '../components/ui';
import { formatRelativeTime } from '../lib/format';
import { MigrationHero } from '../components/migrationdetail/MigrationHero';
import { ServerFlow } from '../components/migrationdetail/ServerFlow';
import { WarningsCard } from '../components/migrationdetail/WarningsCard';
import { ScanReportPanel } from '../components/migrations/ScanReportPanel';

function MigrationDetailSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading migration">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-48" />
        </div>
      </div>
      <SkeletonCard lines={4} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <SkeletonCard lines={3} />
        <div className="hidden w-9 lg:block" />
        <SkeletonCard lines={3} />
      </div>
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}

export default function MigrationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [migration, setMigration] = useState<Migration | null>(null);
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [sourceServer, setSourceServer] = useState<Server | null>(null);
  const [targetServer, setTargetServer] = useState<Server | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [unsuspendOpen, setUnsuspendOpen] = useState(false);

  const fetchData = async () => {
    if (!id) return;
    try {
      const [migrationData, logsData] = await Promise.all([
        getMigration(id),
        getMigrationLogs(id),
      ]);
      setMigration(migrationData);
      setLogs(logsData);
      setLoadError(false);

      // Fetch server details
      if (migrationData.source_server_id) {
        const source = await getServer(migrationData.source_server_id);
        setSourceServer(source);
      }
      if (migrationData.target_server_id) {
        const target = await getServer(migrationData.target_server_id);
        setTargetServer(target);
      }
    } catch (error) {
      console.error('Failed to fetch migration:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Auto-refresh for running migrations
    const interval = setInterval(() => {
      if (migration?.status === 'running' || migration?.status === 'awaiting_review' || migration?.status === 'pending') {
        fetchData();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [id, migration?.status]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchData();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return <MigrationDetailSkeleton />;
  }

  if (!migration) {
    return (
      <div className="space-y-6">
        <PageHeader
          backTo="/migrations"
          eyebrow="Migration"
          title={loadError ? 'Migration unavailable' : 'Migration not found'}
          description={id ? <span className="font-mono text-[13px]">{id}</span> : undefined}
        />
        <Card flush>
          <EmptyState
            icon={loadError ? ExclamationTriangleIcon : ArrowsRightLeftIcon}
            title={loadError ? "Couldn't load this migration" : 'Migration not found'}
            description={
              loadError
                ? 'The API did not respond or returned an error. Try again or go back to the list.'
                : 'It may have been deleted, or the link is wrong.'
            }
            action={
              loadError ? (
                <Button variant="primary" leftIcon={<ArrowPathIcon />} onClick={handleRefresh} loading={refreshing}>
                  Try again
                </Button>
              ) : (
                <Button variant="primary" onClick={() => navigate('/migrations')}>
                  Back to migrations
                </Button>
              )
            }
            secondaryAction={loadError ? <Button variant="secondary" onClick={() => navigate('/migrations')}>Back to migrations</Button> : undefined}
          />
        </Card>
      </div>
    );
  }

  const isRunning = migration.status === 'running' || migration.status === 'awaiting_review';
  const awaitingReview = migration.status === 'awaiting_review';
  const isCompleted = migration.status === 'completed';
  const sourceSuspended = !!migration.source_suspended_at;
  const apiError = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
  const submitDecision = async (action: 'clean' | 'skip' | 'abort') => {
    setDecisionBusy(true);
    try {
      await submitScanDecision(migration.id, action);
      toast.success(action === 'clean' ? 'Cleaning the staging copy, then continuing' : action === 'skip' ? 'Continuing without cleaning' : 'Migration aborted');
      await fetchData();
    } catch (error) {
      toast.error(apiError(error, 'Failed to submit the decision'));
    } finally {
      setDecisionBusy(false);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelMigration(migration.id);
      toast.success('Cancellation requested; the current step is being aborted');
      setCancelOpen(false);
      await fetchData();
    } catch (error) {
      toast.error(apiError(error, 'Failed to cancel the migration'));
    }
  };
  const handleSuspendSource = async () => {
    try {
      await suspendMigrationSource(migration.id);
      toast.success(`${migration.account_username} suspended on the source server`);
      setSuspendOpen(false);
      await fetchData();
    } catch (error) {
      toast.error(apiError(error, 'Failed to suspend the source account'));
    }
  };
  const handleUnsuspendSource = async () => {
    try {
      await unsuspendMigrationSource(migration.id);
      toast.success(`${migration.account_username} re-enabled on the source server`);
      setUnsuspendOpen(false);
      await fetchData();
    } catch (error) {
      toast.error(apiError(error, 'Failed to unsuspend the source account'));
    }
  };
  const warningLogs = logs.filter((log) => log.level === 'warn');
  const domains = migration.export_data?.domains?.map((d) => d.name).filter(Boolean) ?? [];
  const hostsEntry = migration.target_ip && domains.length > 0 ? `${migration.target_ip} ${domains.join(' ')}` : null;

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/migrations"
        eyebrow="Migration"
        title={<span className="font-mono">{migration.account_username}</span>}
        description={`${sourceServer?.name ?? 'Unknown source'} → ${targetServer?.name ?? 'Unknown target'} · created ${formatRelativeTime(migration.created_at)}`}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={migration.status} />
            {isCompleted && (
              <Badge tone={sourceSuspended ? 'neutral' : 'info'} dot>
                {sourceSuspended ? 'Source suspended' : 'Source still active'}
              </Badge>
            )}
          </div>
        }
        actions={
          <>
            <Button variant="secondary" leftIcon={<ArrowPathIcon />} onClick={handleRefresh} loading={refreshing}>
              Refresh
            </Button>
            {(isRunning || migration.status === 'pending') && (
              <Button variant="danger" leftIcon={<StopIcon />} onClick={() => setCancelOpen(true)}>
                Cancel migration
              </Button>
            )}
            {isCompleted && !sourceSuspended && (
              <Button variant="primary" leftIcon={<PauseCircleIcon />} onClick={() => setSuspendOpen(true)}>
                Suspend source
              </Button>
            )}
            {isCompleted && sourceSuspended && (
              <Button variant="outline" leftIcon={<PlayCircleIcon />} onClick={() => setUnsuspendOpen(true)}>
                Unsuspend source
              </Button>
            )}
          </>
        }
      />

      <MigrationHero migration={migration} />

      <ServerFlow source={sourceServer} target={targetServer} migration={migration} />

      {migration.scan_report && (
        <ScanReportPanel
          report={migration.scan_report}
          decided={migration.scan_decision}
          decision={
            awaitingReview
              ? {
                  busy: decisionBusy,
                  onClean: () => submitDecision('clean'),
                  onSkip: () => submitDecision('skip'),
                  onAbort: () => submitDecision('abort'),
                }
              : undefined
          }
        />
      )}

      {hostsEntry && (
        <Card>
          <CardHeader>
            <CardTitle>Hosts entry for testing</CardTitle>
            <CardDescription>
              Add this line to your local <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">/etc/hosts</code> to
              preview the site on the target node before switching DNS.
            </CardDescription>
          </CardHeader>
          <CodeBlock title="/etc/hosts" code={hostsEntry} copiedMessage="Hosts entry copied" />
        </Card>
      )}

      <WarningsCard warnings={warningLogs} />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        tone="warning"
        title="Cancel this migration?"
        message={
          <>
            The current step is aborted immediately. Anything already created on the target (website, uploaded files, database) stays in place, and a
            re-run reuses the website on the same node.
          </>
        }
        confirmLabel="Cancel migration"
        cancelLabel="Keep running"
        onConfirm={handleCancel}
      />

      <ConfirmDialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        tone="warning"
        title="Suspend the source account?"
        message={
          <>
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{migration.account_username}</span> will be suspended on{' '}
            <span className="font-medium">{sourceServer?.name ?? 'the source server'}</span>. Do this only after the IP/DNS switch, once the site is
            verified to load from the new server. The migrated site on the target is not affected, and you can unsuspend at any time.
          </>
        }
        confirmLabel="Suspend on source"
        cancelLabel="Not yet"
        onConfirm={handleSuspendSource}
      />

      <ConfirmDialog
        open={unsuspendOpen}
        onClose={() => setUnsuspendOpen(false)}
        tone="brand"
        title="Re-enable the source account?"
        message={
          <>
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{migration.account_username}</span> will be active again on{' '}
            <span className="font-medium">{sourceServer?.name ?? 'the source server'}</span>.
          </>
        }
        confirmLabel="Unsuspend"
        onConfirm={handleUnsuspendSource}
      />

      <section className="space-y-3" aria-labelledby="migration-log-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="migration-log-heading" className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Migration log
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {isRunning ? 'Refreshes automatically every 5 seconds while the migration is running.' : 'Full run history for this migration.'}
            </p>
          </div>
          {loadError && (
            <p className="text-xs text-rose-600 dark:text-rose-400" role="status">
              Last refresh failed — showing the last data received.
            </p>
          )}
        </div>
        <LogViewer items={logs} live={isRunning} height="32rem" title="Console" emptyMessage="No log lines yet" />
      </section>
    </div>
  );
}
