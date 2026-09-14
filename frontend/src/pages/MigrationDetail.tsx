import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowPathIcon, PauseCircleIcon, PlayCircleIcon, PlayIcon, StopIcon, WrenchScrewdriverIcon } from '@heroicons/react/20/solid';
import { cancelMigration, getMigration, getMigrationLogsPage, getServer, repairMigrationWordPress, rerunMigration, submitScanDecision, suspendMigrationSource, unsuspendMigrationSource } from '../api/client';
import type { Migration, MigrationLog, Server } from '../types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, LogViewer, Mono, PageHeader, Skeleton, SkeletonCard, StatusBadge } from '../components/ui';
import { formatRelativeTime } from '../lib/format';
import { useT } from '../lib/i18n';
import { deriveTimeline, parseInventory } from '../lib/migrationSteps';
import { MigrationHero } from '../components/migrationdetail/MigrationHero';
import { NextStepsCard } from '../components/migrationdetail/NextStepsCard';
import { RunTimeline } from '../components/migrationdetail/RunTimeline';
import { ServerFlow } from '../components/migrationdetail/ServerFlow';
import { WarningsCard } from '../components/migrationdetail/WarningsCard';
import { ScanReportPanel } from '../components/migrations/ScanReportPanel';

const RISE = 'motion-safe:animate-rise stagger';
const stagger = (i: number) => ({ '--i': i }) as CSSProperties;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function MigrationDetailSkeleton() {
  const t = useT();
  return (
    <div className="space-y-6" role="status" aria-label={t('migrationdetail.loading')}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-48" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <SkeletonCard lines={4} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <SkeletonCard lines={3} />
            <div className="hidden w-24 lg:block" />
            <SkeletonCard lines={3} />
          </div>
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
        <SkeletonCard lines={10} />
      </div>
    </div>
  );
}

export default function MigrationDetail() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
  const [repairOpen, setRepairOpen] = useState(false);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [unsuspendOpen, setUnsuspendOpen] = useState(false);
  const [jumpToId, setJumpToId] = useState<string | null>(null);
  const deepLinkedRef = useRef(false);
  const consoleRef = useRef<HTMLElement | null>(null);

  const [logsTotal, setLogsTotal] = useState(0);
  const [logsTruncated, setLogsTruncated] = useState(false);
  const lastLogAtRef = useRef<string | null>(null);

  /** full = reload the last page of the log; otherwise only lines newer than the last one seen are appended. */
  const fetchData = async (full = true) => {
    if (!id) return;
    try {
      const after = !full && lastLogAtRef.current ? lastLogAtRef.current : undefined;
      const [migrationData, page] = await Promise.all([
        getMigration(id),
        getMigrationLogsPage(id, after ? { after } : { limit: 1000 }),
      ]);
      setMigration(migrationData);
      if (after) {
        if (page.items.length > 0) {
          setLogs((prev) => {
            const seen = new Set(prev.map((l) => l.id));
            return [...prev, ...page.items.filter((l) => !seen.has(l.id))];
          });
        }
      } else {
        setLogs(page.items);
        setLogsTruncated(page.truncated);
      }
      setLogsTotal(page.total);
      const newest = page.items.length > 0 ? page.items[page.items.length - 1].created_at : null;
      if (newest) lastLogAtRef.current = newest;
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
        fetchData(false);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [id, migration?.status]);

  // Timeline + inventory are derived from the log that already arrives.
  const timeline = useMemo(
    () => (migration ? deriveTimeline(logs, migration, { scan: !!migration.scan_requested }) : []),
    [logs, migration],
  );
  const inventory = useMemo(() => parseInventory(logs), [logs]);
  // Console section headers: the step's translated name, isolated (U+2068 first-strong isolate ... U+2069)
  // so a Hebrew name with Latin words inside keeps its order in the always-LTR console.
  const sections = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of timeline) if (item.firstLogId) map.set(item.firstLogId, `\u2068${t(`steps.${item.id}.name`)}\u2069`);
    return map;
  }, [timeline, t]);

  // Bring the console into view and hand the line to the viewer, which centers and flashes it.
  // Reset first so jumping to the same line twice flashes again.
  const jumpTo = (logId: string) => {
    consoleRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    setJumpToId(null);
    window.setTimeout(() => setJumpToId(logId), 0);
  };

  // Deep link: /migrations/:id?line=<logId> brings the console into view and flashes that line once it is rendered.
  useEffect(() => {
    if (deepLinkedRef.current || loading || logs.length === 0) return;
    deepLinkedRef.current = true;
    const line = searchParams.get('line');
    if (line) jumpTo(line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, logs, searchParams]);

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
          eyebrow={t('migrationdetail.eyebrow')}
          title={loadError ? t('migrationdetail.unavailable.title') : t('migrationdetail.notFound.title')}
          description={id ? <Mono className="text-[13px]">{id}</Mono> : undefined}
        />
        <Card flush>
          <EmptyState
            illustration={loadError ? 'error' : 'search'}
            title={loadError ? t('migrationdetail.unavailable.empty') : t('migrationdetail.notFound.title')}
            description={loadError ? t('migrationdetail.unavailable.description') : t('migrationdetail.notFound.description')}
            action={
              loadError ? (
                <Button variant="primary" leftIcon={<ArrowPathIcon />} onClick={handleRefresh} loading={refreshing}>
                  {t('common.tryAgain')}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => navigate('/migrations')}>
                  {t('migrationdetail.backToList')}
                </Button>
              )
            }
            secondaryAction={
              loadError ? (
                <Button variant="secondary" onClick={() => navigate('/migrations')}>
                  {t('migrationdetail.backToList')}
                </Button>
              ) : undefined
            }
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
      toast.success(
        action === 'clean' ? t('migrationdetail.toast.clean') : action === 'skip' ? t('migrationdetail.toast.skip') : t('migrationdetail.toast.abort'),
      );
      await fetchData();
    } catch (error) {
      toast.error(apiError(error, t('migrationdetail.toast.decisionFailed')));
    } finally {
      setDecisionBusy(false);
    }
  };

  const handleRerun = async () => {
    setRerunning(true);
    try {
      const created = await rerunMigration(migration.id);
      toast.success(t('migrationdetail.toast.rerunStarted', { account: migration.account_username }));
      setRerunOpen(false);
      navigate(`/migrations/${created.id}`);
    } catch (error) {
      toast.error(apiError(error, t('migrationdetail.toast.rerunFailed')));
    } finally {
      setRerunning(false);
    }
  };

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const { summary } = await repairMigrationWordPress(migration.id);
      toast.success(summary.length ? summary.join(' · ') : t('migrationdetail.toast.repairNothing'), { duration: 8000 });
      setRepairOpen(false);
      await fetchData();
    } catch (error) {
      toast.error(apiError(error, t('migrationdetail.toast.repairFailed')));
    } finally {
      setRepairing(false);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelMigration(migration.id);
      toast.success(t('migrationdetail.toast.cancelRequested'));
      setCancelOpen(false);
      await fetchData();
    } catch (error) {
      toast.error(apiError(error, t('migrationdetail.toast.cancelFailed')));
    }
  };
  const handleSuspendSource = async () => {
    try {
      await suspendMigrationSource(migration.id);
      toast.success(t('migrationdetail.toast.suspended', { account: migration.account_username }));
      setSuspendOpen(false);
      await fetchData();
    } catch (error) {
      toast.error(apiError(error, t('migrationdetail.toast.suspendFailed')));
    }
  };
  const handleUnsuspendSource = async () => {
    try {
      await unsuspendMigrationSource(migration.id);
      toast.success(t('migrationdetail.toast.unsuspended', { account: migration.account_username }));
      setUnsuspendOpen(false);
      await fetchData();
    } catch (error) {
      toast.error(apiError(error, t('migrationdetail.toast.unsuspendFailed')));
    }
  };
  const warningLogs = logs.filter((log) => log.level === 'warn');
  const domains = migration.export_data?.domains?.map((d) => d.name).filter(Boolean) ?? [];
  const hostsEntry = migration.target_ip && domains.length > 0 ? `${migration.target_ip} ${domains.join(' ')}` : null;

  const accountMono = <Mono className="font-medium text-slate-900 dark:text-slate-100">{migration.account_username}</Mono>;
  const sourceMono = sourceServer ? <Mono>{sourceServer.name}</Mono> : t('migrationdetail.confirm.sourceServer');

  return (
    <div className="space-y-6">
      <PageHeader
          backTo="/migrations"
          eyebrow={t('migrationdetail.eyebrow')}
          title={<Mono>{migration.account_username}</Mono>}
          description={t.rich('migrationdetail.description', {
            source: sourceServer ? <Mono>{sourceServer.name}</Mono> : t('migrationdetail.unknownSource'),
            target: targetServer ? <Mono>{targetServer.name}</Mono> : t('migrationdetail.unknownTarget'),
            created: formatRelativeTime(migration.created_at),
          })}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={migration.status} />
              {isCompleted && (
                <Badge tone={sourceSuspended ? 'neutral' : 'info'} dot>
                  {sourceSuspended ? t('status.sourceSuspended') : t('status.sourceActive')}
                </Badge>
              )}
            </div>
          }
          actions={
            <>
              <Button variant="secondary" leftIcon={<ArrowPathIcon />} onClick={handleRefresh} loading={refreshing}>
                {t('common.refresh')}
              </Button>
              {(isRunning || migration.status === 'pending') && (
                <Button variant="danger" leftIcon={<StopIcon />} onClick={() => setCancelOpen(true)}>
                  {t('migrationdetail.actions.cancel')}
                </Button>
              )}
              {isCompleted && !sourceSuspended && (
                <Button variant="primary" leftIcon={<PauseCircleIcon />} onClick={() => setSuspendOpen(true)}>
                  {t('migrationdetail.actions.suspend')}
                </Button>
              )}
              {isCompleted && sourceSuspended && (
                <Button variant="outline" leftIcon={<PlayCircleIcon />} onClick={() => setUnsuspendOpen(true)}>
                  {t('migrationdetail.actions.unsuspend')}
                </Button>
              )}
              {isCompleted && (
                <Button variant="outline" leftIcon={<WrenchScrewdriverIcon />} onClick={() => setRepairOpen(true)} loading={repairing}>
                  {t('migrationdetail.actions.repair')}
                </Button>
              )}
              {(migration.status === 'failed' || migration.status === 'cancelled') && (
                <Button variant="primary" leftIcon={<PlayIcon />} onClick={() => setRerunOpen(true)} loading={rerunning}>
                  {t('migrationdetail.actions.rerun')}
                </Button>
              )}
            </>
          }
        />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <MigrationHero
            migration={migration}
            logs={logs}
            inventory={inventory}
            warningCount={warningLogs.length}
            timeline={timeline}
            className={RISE}
            style={stagger(1)}
          />

          {isCompleted && (
            <NextStepsCard
              migration={migration}
              sourceName={sourceServer?.name}
              hostsEntry={hostsEntry}
              domains={domains}
              onSuspend={() => setSuspendOpen(true)}
              onUnsuspend={() => setUnsuspendOpen(true)}
              className={RISE}
              style={stagger(2)}
            />
          )}

          <ServerFlow source={sourceServer} target={targetServer} migration={migration} className={RISE} style={stagger(3)} />

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

          <WarningsCard warnings={warningLogs} onJump={jumpTo} className={RISE} style={stagger(4)} />

          <section ref={consoleRef} className={`scroll-mt-20 space-y-3 ${RISE}`} style={stagger(5)} aria-labelledby="migration-log-heading">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 id="migration-log-heading" className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                  {t('migrationdetail.log.title')}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {isRunning ? t('migrationdetail.log.live') : t('migrationdetail.log.history')}
                </p>
              </div>
              {loadError && (
                <p className="text-xs text-rose-600 dark:text-rose-400" role="status">
                  {t('migrationdetail.log.refreshFailed')}
                </p>
              )}
              {logsTruncated && (
                <p className="text-xs text-slate-500 dark:text-slate-400" role="status">
                  {t('migrationdetail.log.truncated', { shown: logs.length, total: logsTotal })}
                </p>
              )}
            </div>
            <LogViewer
              items={logs}
              live={isRunning}
              height="32rem"
              title={t('migrationdetail.console')}
              jumpToId={jumpToId}
              sectionFor={(item) => sections.get(item.id) ?? null}
            />
          </section>
        </div>

        <div className="min-w-0">
          <RunTimeline
            items={timeline}
            live={isRunning}
            onJump={jumpTo}
            sourceName={sourceServer?.name}
            targetName={migration.target_node || targetServer?.name}
            className={RISE}
            style={stagger(2)}
          />
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        tone="warning"
        title={t('migrationdetail.confirm.cancel.title')}
        message={t('migrationdetail.confirm.cancel.message')}
        confirmLabel={t('migrationdetail.confirm.cancel.confirm')}
        cancelLabel={t('migrationdetail.confirm.cancel.keep')}
        onConfirm={handleCancel}
      />

      <ConfirmDialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        tone="warning"
        title={t('migrationdetail.confirm.suspend.title')}
        message={t.rich('migrationdetail.confirm.suspend.message', { account: accountMono, server: sourceMono })}
        confirmLabel={t('migrationdetail.confirm.suspend.confirm')}
        cancelLabel={t('migrationdetail.confirm.suspend.notYet')}
        onConfirm={handleSuspendSource}
      />

      <ConfirmDialog
        open={unsuspendOpen}
        onClose={() => setUnsuspendOpen(false)}
        tone="brand"
        title={t('migrationdetail.confirm.unsuspend.title')}
        message={t.rich('migrationdetail.confirm.unsuspend.message', { account: accountMono, server: sourceMono })}
        confirmLabel={t('migrationdetail.confirm.unsuspend.confirm')}
        onConfirm={handleUnsuspendSource}
      />

      <ConfirmDialog
        open={repairOpen}
        onClose={() => setRepairOpen(false)}
        tone="brand"
        title={t('migrationdetail.confirm.repair.title')}
        message={t.rich('migrationdetail.confirm.repair.message', { leftovers: <Mono>migration-leftovers</Mono> })}
        confirmLabel={t('migrationdetail.confirm.repair.confirm')}
        onConfirm={handleRepair}
      />

      <ConfirmDialog
        open={rerunOpen}
        onClose={() => setRerunOpen(false)}
        tone="brand"
        title={t('migrationdetail.confirm.rerun.title')}
        message={t.rich('migrationdetail.confirm.rerun.message', {
          account: <Mono>{migration.account_username}</Mono>,
          scan: migration.scan_requested ? t('migrationdetail.confirm.rerun.withScan') : '',
        })}
        confirmLabel={t('migrationdetail.confirm.rerun.confirm')}
        onConfirm={handleRerun}
      />
    </div>
  );
}
