import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowPathIcon, ChevronRightIcon, ExclamationTriangleIcon } from '@heroicons/react/16/solid';
import { ArrowTopRightOnSquareIcon, PauseCircleIcon, PlayIcon, StopIcon } from '@heroicons/react/20/solid';
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  LogViewer,
  Mono,
  PageHeader,
  PanelMonogram,
  ProgressBar,
  SkeletonCard,
  StatusBadge,
  Table,
  TBody,
  TD,
  TDPrimary,
  TH,
  THead,
  TR,
} from '../components/ui';
import { RunTimeline } from '../components/migrationdetail/RunTimeline';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';
import { isAgentlessPanel } from '../lib/agentless';
import { deriveTimeline, matchStepId } from '../lib/migrationSteps';
import { formatDuration, formatRelativeTime, percent, realDate, runWindow, shortId } from '../lib/format';
import {
  cancelMigration,
  getMigration,
  getMigrationBatch,
  getMigrationLogsPage,
  getServers,
  rerunMigration,
  resumeMigration,
  suspendMigrationSource,
} from '../api/client';
import type { Migration, MigrationBatch, MigrationLog, Server } from '../types';

const ACTIVE = new Set(['pending', 'running', 'awaiting_review']);
const FINISHED = new Set(['completed', 'failed', 'cancelled']);

/** Latest attempt per account: a rerun lands in the same batch, so collapse older rows by username. */
function latestPerAccount(migrations: Migration[]): Migration[] {
  const byAccount = new Map<string, Migration>();
  for (const m of migrations) {
    const prev = byAccount.get(m.account_username);
    if (!prev || new Date(m.created_at).getTime() >= new Date(prev.created_at).getTime()) {
      byAccount.set(m.account_username, m);
    }
  }
  return [...byAccount.values()].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

/** The per-account detail that opens in place under a row: this migration's step timeline and live log. */
function ExpandedDetail({ migrationId, live, source, target }: { migrationId: string; live: boolean; source?: Server; target?: Server }) {
  const t = useT();
  const [migration, setMigration] = useState<Migration | null>(null);
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDetail = useCallback(async () => {
    try {
      const [m, page] = await Promise.all([getMigration(migrationId), getMigrationLogsPage(migrationId, { limit: 1000 })]);
      setMigration(m);
      setLogs(page.items);
    } catch {
      /* keep last-known state; the row above still shows the status */
    } finally {
      setLoading(false);
    }
  }, [migrationId]);

  useEffect(() => {
    fetchDetail();
    if (!live) return;
    const interval = setInterval(fetchDetail, 5000);
    return () => clearInterval(interval);
  }, [fetchDetail, live]);

  const timeline = useMemo(
    () => (migration ? deriveTimeline(logs, migration, { scan: !!migration.scan_requested }) : []),
    [logs, migration],
  );
  const isRunning = migration?.status === 'running' || migration?.status === 'awaiting_review';

  if (loading && !migration) {
    return (
      <div className="px-4 py-4">
        <SkeletonCard lines={5} />
      </div>
    );
  }

  return (
    <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('batch.detail.log')}</h3>
        <LogViewer items={logs} live={isRunning} height="22rem" title={t('migrationdetail.console')} />
      </div>
      <div className="min-w-0">
        <RunTimeline
          items={timeline}
          live={!!isRunning}
          onJump={() => {}}
          sourceName={source?.name}
          targetName={migration?.target_node || target?.name}
        />
      </div>
    </div>
  );
}

export default function BatchMigration() {
  const t = useT();
  const navigate = useNavigate();
  const { batchId } = useParams<{ batchId: string }>();
  const [batch, setBatch] = useState<MigrationBatch | null>(null);
  const [servers, setServers] = useState<Record<string, Server>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [retryOpen, setRetryOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspending, setSuspending] = useState(false);

  const apiError = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

  const fetchBatch = useCallback(async () => {
    if (!batchId) return;
    try {
      const data = await getMigrationBatch(batchId);
      setBatch(data);
      setLoadError(false);
    } catch (error) {
      console.error('Failed to fetch batch:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    let cancelled = false;
    getServers()
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, Server> = {};
        list.forEach((s) => (map[s.id] = s));
        setServers(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetchBatch();
    const interval = setInterval(fetchBatch, 5000);
    return () => clearInterval(interval);
  }, [fetchBatch]);

  // Latest attempt per account; the tally and progress are computed over that collapsed list.
  const rows = useMemo(() => (batch ? latestPerAccount(batch.migrations) : []), [batch]);
  const tally = useMemo(() => {
    let completed = 0;
    let failed = 0;
    let active = 0;
    let warnings = 0;
    for (const m of rows) {
      if (m.status === 'completed') completed++;
      else if (m.status === 'failed' || m.status === 'cancelled') failed++;
      else active++;
      warnings += m.warnings ?? 0;
    }
    return { total: rows.length, completed, failed, active, warnings, finished: completed + failed };
  }, [rows]);

  const allDone = tally.total > 0 && tally.active === 0;
  const progressTone = allDone ? (tally.failed > 0 ? 'warning' : 'success') : 'brand';

  // Failed / cancelled rows can be retried; completed rows on a panel we can suspend offer the post-step.
  const failedRows = rows.filter((m) => m.status === 'failed' || m.status === 'cancelled');
  const canSuspend = (m: Migration) => {
    const src = servers[m.source_server_id];
    const manual = isAgentlessPanel(src?.panel_type) || src?.panel_type === 'cloudways';
    return m.status === 'completed' && !m.source_suspended_at && !manual;
  };
  const suspendableRows = rows.filter(canSuspend);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleRetryFailed = async () => {
    setRetrying(true);
    let ok = 0;
    let bad = 0;
    for (const m of failedRows) {
      try {
        await rerunMigration(m.id);
        ok++;
      } catch {
        bad++;
      }
    }
    setRetrying(false);
    setRetryOpen(false);
    if (ok > 0) toast.success(t('batch.toast.retried', { count: ok }));
    if (bad > 0) toast.error(t('batch.toast.retryFailed', { count: bad }));
    await fetchBatch();
  };

  const handleSuspendAll = async () => {
    setSuspending(true);
    let ok = 0;
    let bad = 0;
    for (const m of suspendableRows) {
      try {
        await suspendMigrationSource(m.id);
        ok++;
      } catch {
        bad++;
      }
    }
    setSuspending(false);
    setSuspendOpen(false);
    if (ok > 0) toast.success(t('batch.toast.suspended', { count: ok }));
    if (bad > 0) toast.error(t('batch.toast.suspendFailed', { count: bad }));
    await fetchBatch();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchBatch();
    } finally {
      setRefreshing(false);
    }
  };

  const handleRowResume = async (m: Migration) => {
    try {
      if (m.export_data) await resumeMigration(m.id);
      else await rerunMigration(m.id);
      toast.success(t('batch.toast.rowRetried', { account: m.account_username }));
      await fetchBatch();
    } catch (error) {
      toast.error(apiError(error, t('batch.toast.rowRetryFailed')));
    }
  };

  const handleRowCancel = async (m: Migration) => {
    try {
      await cancelMigration(m.id);
      toast.success(t('batch.toast.rowCancelled', { account: m.account_username }));
      await fetchBatch();
    } catch (error) {
      toast.error(apiError(error, t('batch.toast.rowCancelFailed')));
    }
  };

  const stepLabel = (m: Migration) => {
    if (FINISHED.has(m.status)) return null;
    const id = m.current_step ? matchStepId(m.current_step) : null;
    return id ? t(`steps.${id}.name`) : m.current_step || t('migrations.row.working');
  };

  if (loading && !batch) {
    return (
      <div className="space-y-6" role="status" aria-label={t('batch.loading')}>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={8} />
      </div>
    );
  }

  if (!batch || tally.total === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          backTo="/migrations"
          eyebrow={t('batch.eyebrow')}
          title={t(loadError ? 'batch.unavailable.title' : 'batch.notFound.title')}
          description={batchId ? <Mono className="text-[13px]">{shortId(batchId)}</Mono> : undefined}
        />
        <Card flush>
          <EmptyState
            illustration={loadError ? 'error' : 'search'}
            title={t(loadError ? 'batch.unavailable.title' : 'batch.notFound.title')}
            description={t(loadError ? 'batch.unavailable.description' : 'batch.notFound.description')}
            action={
              loadError ? (
                <Button variant="primary" leftIcon={<ArrowPathIcon />} onClick={handleRefresh} loading={refreshing}>
                  {t('common.tryAgain')}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => navigate('/migrations')}>
                  {t('batch.backToList')}
                </Button>
              )
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/migrations"
        eyebrow={t('batch.eyebrow')}
        title={t('batch.title')}
        description={t('batch.description', { count: tally.total, created: formatRelativeTime(batch.created_at) })}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={allDone ? (tally.failed > 0 ? 'cancelled' : 'completed') : 'running'} label={allDone ? (tally.failed > 0 ? t('batch.state.mixed') : t('batch.state.done')) : t('batch.state.running')} />
            {tally.warnings > 0 && (
              <Badge tone="warning" size="sm" icon={<ExclamationTriangleIcon />}>
                {tally.warnings}
              </Badge>
            )}
          </div>
        }
        actions={
          <>
            <Button variant="secondary" leftIcon={<ArrowPathIcon />} onClick={handleRefresh} loading={refreshing}>
              {t('common.refresh')}
            </Button>
            {failedRows.length > 0 && (
              <Button variant="primary" leftIcon={<PlayIcon />} onClick={() => setRetryOpen(true)} loading={retrying}>
                {t('batch.action.retryFailed', { count: failedRows.length })}
              </Button>
            )}
            {suspendableRows.length > 0 && (
              <Button variant="outline" leftIcon={<PauseCircleIcon />} onClick={() => setSuspendOpen(true)} loading={suspending}>
                {t('batch.action.suspendAll', { count: suspendableRows.length })}
              </Button>
            )}
          </>
        }
      />

      {/* Overall progress */}
      <Card className="motion-safe:animate-rise">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {t('batch.progress.headline', { done: tally.finished, total: tally.total })}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="text-emerald-600 dark:text-emerald-400">{t('batch.progress.completed', { count: tally.completed })}</span>
              <span className="text-brand-700 dark:text-brand-300">{t('batch.progress.running', { count: tally.active })}</span>
              <span className={tally.failed > 0 ? 'text-rose-600 dark:text-rose-400' : undefined}>{t('batch.progress.failed', { count: tally.failed })}</span>
            </div>
          </div>
          <bdi dir="ltr" className="tabular text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {percent(tally.finished, tally.total)}%
          </bdi>
        </div>
        <div className="mt-3">
          <ProgressBar
            value={percent(tally.finished, tally.total)}
            tone={progressTone}
            live={!allDone}
            size="md"
            label={t('batch.progress.headline', { done: tally.finished, total: tally.total })}
          />
        </div>
      </Card>

      {/* Per-account rows */}
      <Card flush className="motion-safe:animate-rise">
        <CardHeader divided>
          <CardTitle>{t('batch.table.title')}</CardTitle>
          <CardDescription>{t('batch.table.description')}</CardDescription>
        </CardHeader>
        <Table bare stickyHeader maxHeight="70vh" className="[&_td]:px-3 [&_th]:px-3">
          <THead>
            <TR hoverable={false}>
              <TH>{t('batch.col.account')}</TH>
              <TH>{t('batch.col.status')}</TH>
              <TH className="hidden lg:table-cell">{t('batch.col.node')}</TH>
              <TH>{t('batch.col.timing')}</TH>
              <TH align="end">
                <span className="sr-only">{t('table.actions')}</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((m) => {
              const isOpen = expanded.has(m.id);
              const isRunning = m.status === 'running' || m.status === 'awaiting_review';
              const isActive = ACTIVE.has(m.status);
              const step = stepLabel(m);
              const source = servers[m.source_server_id];
              const target = servers[m.target_server_id];
              const win = runWindow(m, []);
              const duration = win.startedAt && (isRunning || win.endedAt) ? formatDuration(win.startedAt, isRunning ? undefined : win.endedAt) : null;
              const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
              return (
                <Fragment key={m.id}>
                  <TR clickable onClick={() => toggleExpand(m.id)} className={cn('group', isRunning && 'bg-brand-50/40 dark:bg-brand-500/[0.06]')}>
                    <TDPrimary>
                      <div className="flex items-center gap-2">
                        <ChevronRightIcon
                          className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform dark:text-slate-500', isOpen && 'rotate-90')}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <Mono className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{m.account_username}</Mono>
                          <div className="mt-0.5">
                            <Mono className="text-2xs text-slate-400 dark:text-slate-500">{shortId(m.id)}</Mono>
                          </div>
                        </div>
                      </div>
                    </TDPrimary>

                    <TD className="min-w-[180px]">
                      <StatusBadge status={m.status} size="sm" />
                      {isActive && (
                        <div className="mt-1.5 max-w-[240px]">
                          <ProgressBar size="xs" live value={percent(m.completed_steps, m.total_steps)} label={step ?? ''} />
                          <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-slate-500 dark:text-slate-400">
                            <span className="truncate" title={m.current_step}>
                              {step}
                            </span>
                            <bdi dir="ltr" className="tabular shrink-0 font-medium text-brand-700 dark:text-brand-300">
                              {m.completed_steps}/{m.total_steps}
                            </bdi>
                          </div>
                        </div>
                      )}
                      {m.status === 'completed' && m.source_suspended_at && (
                        <div className="mt-1.5">
                          <Badge tone="neutral" size="sm" dot>
                            {t('status.sourceSuspended')}
                          </Badge>
                        </div>
                      )}
                      {(m.status === 'failed' || m.status === 'cancelled') && m.error && (
                        <div className="mt-1 text-2xs text-rose-600 dark:text-rose-400" title={m.error}>
                          <bdi dir="ltr" className="inline-block max-w-[240px] truncate align-bottom">
                            {m.error}
                          </bdi>
                        </div>
                      )}
                    </TD>

                    <TD className="hidden lg:table-cell">
                      {m.target_node || m.target_ip ? (
                        <div className="whitespace-nowrap leading-tight">
                          {m.target_node && <Mono className="block text-xs text-slate-700 dark:text-slate-300">{m.target_node}</Mono>}
                          {m.target_ip && <Mono className="block text-xs text-slate-500 dark:text-slate-400">{m.target_ip}</Mono>}
                        </div>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">{t('common.notAvailable')}</span>
                      )}
                    </TD>

                    <TD muted className="whitespace-nowrap">
                      <div>{formatRelativeTime(realDate(m.started_at) ?? m.created_at)}</div>
                      {duration && <div className={cn('mt-0.5 text-2xs tabular', isRunning && 'font-medium text-brand-700 dark:text-brand-300')}>{duration}</div>}
                    </TD>

                    <TD align="end" onClick={stop} onKeyDown={stop} className="whitespace-nowrap">
                      <div className="inline-flex items-center gap-1 opacity-70 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        {isActive && (
                          <Button variant="outline" size="sm" leftIcon={<StopIcon />} onClick={() => handleRowCancel(m)}>
                            {t('migrations.row.cancel')}
                          </Button>
                        )}
                        {(m.status === 'failed' || m.status === 'cancelled') && (
                          <Button variant="primary" size="sm" leftIcon={<PlayIcon />} onClick={() => handleRowResume(m)}>
                            {t('batch.row.retry')}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" rightIcon={<ArrowTopRightOnSquareIcon className="flip-rtl" />} onClick={() => navigate(`/migrations/${m.id}`)}>
                          {t('batch.row.open')}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                  {isOpen && (
                    <TR hoverable={false}>
                      <TD colSpan={5} className="!p-0">
                        <div className="border-s-2 border-brand-200 bg-slate-50/60 dark:border-brand-500/30 dark:bg-white/[0.02]">
                          <div className="flex items-center gap-2 px-4 pt-3 text-xs text-slate-500 dark:text-slate-400">
                            {source && <PanelMonogram panelType={source.panel_type} size="sm" />}
                            <span>{source?.name ?? t('common.unknown')}</span>
                            <span aria-hidden="true">→</span>
                            {target && <PanelMonogram panelType={target.panel_type} size="sm" />}
                            <span>{m.target_node || target?.name || t('common.unknown')}</span>
                          </div>
                          <ExpandedDetail migrationId={m.id} live={isActive} source={source} target={target} />
                        </div>
                      </TD>
                    </TR>
                  )}
                </Fragment>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <ConfirmDialog
        open={retryOpen}
        onClose={() => setRetryOpen(false)}
        tone="brand"
        title={t('batch.confirm.retry.title')}
        message={t('batch.confirm.retry.message', { count: failedRows.length })}
        confirmLabel={t('batch.confirm.retry.confirm')}
        onConfirm={handleRetryFailed}
      />

      <ConfirmDialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        tone="warning"
        title={t('batch.confirm.suspend.title')}
        message={t('batch.confirm.suspend.message', { count: suspendableRows.length })}
        confirmLabel={t('batch.confirm.suspend.confirm')}
        cancelLabel={t('batch.confirm.suspend.notYet')}
        onConfirm={handleSuspendAll}
      />
    </div>
  );
}
