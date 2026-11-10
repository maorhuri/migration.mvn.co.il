import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowRightIcon } from '@heroicons/react/16/solid';
import { ArrowTopRightOnSquareIcon, CheckCircleIcon, PlusIcon, Squares2X2Icon, TrashIcon } from '@heroicons/react/20/solid';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Mono,
  PageHeader,
  PanelMonogram,
  ProgressBar,
  SkeletonTable,
  StatusBadge,
  Table,
  Tabs,
  TBody,
  TD,
  TDPrimary,
  TH,
  THead,
  TR,
} from '../components/ui';
import { MigrationRow } from '../components/migrations/MigrationRow';
import { useT } from '../lib/i18n';
import { cn } from '../lib/cn';
import { formatRelativeTime, percent, shortId } from '../lib/format';
import { getMigrations, getServers, cancelMigration, deleteMigration, clearFinishedMigrations, dismissMigrationBatch, suspendMigrationSource, unsuspendMigrationSource } from '../api/client';
import type { Migration, Server } from '../types';

type StatusFilter = 'all' | 'running' | 'completed' | 'failed';

/** Aggregate of one batch, collapsed from its migrations for the single row that stands in for it. */
interface BatchAgg {
  id: string;
  total: number;
  completed: number;
  failed: number;
  active: number;
  warnings: number;
  createdAt: string;
  sourceId: string;
  targetId: string;
  /** True once the batch was marked "done handling" (every migration carries batch_dismissed_at). */
  dismissed: boolean;
}

/** One batch collapsed into a single list row: account count, aggregate status/progress, started
 * time, linking to the consolidated batch view — instead of N separate migration rows. */
function BatchListRow({
  batch,
  source,
  target,
  onOpen,
  onDismiss,
}: {
  batch: BatchAgg;
  source?: Server;
  target?: Server;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const done = batch.active === 0;
  const status = done ? (batch.failed > 0 ? 'cancelled' : 'completed') : 'running';
  const stateLabel = done ? (batch.failed > 0 ? t('batch.state.mixed') : t('batch.state.done')) : t('batch.state.running');
  const finished = batch.completed + batch.failed;
  const nameClass = (known: boolean) => cn('truncate max-w-[10rem]', known ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500');
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <TR clickable onClick={onOpen} className={cn('group', !done && 'bg-brand-50/40 dark:bg-brand-500/[0.06]', batch.dismissed && 'opacity-60')}>
      <TDPrimary>
        <div className="flex items-center gap-2">
          <Squares2X2Icon className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          <div className="min-w-0">
            <span className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{t('batch.list.accounts', { count: batch.total })}</span>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Mono className="text-2xs text-slate-400 dark:text-slate-500">{shortId(batch.id)}</Mono>
              {batch.dismissed && (
                <Badge tone="neutral" size="sm">
                  {t('batch.list.dismissedBadge')}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </TDPrimary>

      <TD>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <PanelMonogram panelType={source?.panel_type} size="sm" />
            <span className={nameClass(!!source)} title={source?.name}>
              {source?.name ?? t('common.unknown')}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <ArrowRightIcon className="flip-rtl h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            <PanelMonogram panelType={target?.panel_type} size="sm" />
            <span className={nameClass(!!target)} title={target?.name}>
              {target?.name ?? t('common.unknown')}
            </span>
          </span>
        </div>
      </TD>

      <TD className="hidden 2xl:table-cell">
        <span className="text-slate-400 dark:text-slate-500">{t('common.notAvailable')}</span>
      </TD>

      <TD className="min-w-[150px]">
        <StatusBadge status={status} size="sm" label={stateLabel} />
        <div className="mt-1.5 max-w-[220px]">
          <ProgressBar size="xs" live={!done} value={percent(finished, batch.total)} label={stateLabel} />
          <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-slate-500 dark:text-slate-400">
            <span className="flex flex-wrap gap-x-2">
              <span className="text-emerald-600 dark:text-emerald-400">{t('batch.progress.completed', { count: batch.completed })}</span>
              {batch.active > 0 && <span className="text-brand-700 dark:text-brand-300">{t('batch.progress.running', { count: batch.active })}</span>}
              {batch.failed > 0 && <span className="text-rose-600 dark:text-rose-400">{t('batch.progress.failed', { count: batch.failed })}</span>}
            </span>
            <bdi dir="ltr" className="tabular shrink-0 font-medium text-brand-700 dark:text-brand-300">
              {finished}/{batch.total}
            </bdi>
          </div>
        </div>
      </TD>

      <TD>
        {batch.warnings > 0 ? (
          <Badge tone="warning" size="sm" icon={<ExclamationTriangleIcon />}>
            {batch.warnings}
          </Badge>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">{t('common.notAvailable')}</span>
        )}
      </TD>

      <TD muted className="whitespace-nowrap">
        <div>{formatRelativeTime(batch.createdAt)}</div>
      </TD>

      <TD align="end" onClick={stop} onKeyDown={stop} className="whitespace-nowrap">
        <div className="inline-flex items-center gap-1 opacity-70 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button variant="ghost" size="sm" rightIcon={<ArrowTopRightOnSquareIcon className="flip-rtl" />} onClick={onOpen}>
            {t('batch.row.openBatch')}
          </Button>
          {!batch.dismissed && (
            <Button variant="ghost" size="sm" leftIcon={<CheckCircleIcon />} onClick={onDismiss}>
              {t('batch.action.dismiss')}
            </Button>
          )}
        </div>
      </TD>
    </TR>
  );
}

export default function Migrations() {
  const t = useT();
  const navigate = useNavigate();
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [servers, setServers] = useState<Record<string, Server>>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Client-side lens on the same polled list; the polling itself is untouched.
  const [filter, setFilter] = useState<StatusFilter>('all');
  // Dialog targets are kept after close so the message does not blank during the exit transition.
  const [toCancel, setToCancel] = useState<Migration | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Migration | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [toSuspend, setToSuspend] = useState<Migration | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [toUnsuspend, setToUnsuspend] = useState<Migration | null>(null);
  const [unsuspendOpen, setUnsuspendOpen] = useState(false);
  // Batch to mark "done handling" (kept after close so the dialog does not blank mid-transition).
  const [toDismiss, setToDismiss] = useState<string | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  // Dismissed batches drop off the listing; this reveals them again (with a "handled" marker).
  const [showDismissed, setShowDismissed] = useState(false);

  const fetchData = async () => {
    try {
      const [migrationsData, serversData] = await Promise.all([
        getMigrations(),
        getServers(),
      ]);
      setMigrations(migrationsData);

      const serversMap: Record<string, Server> = {};
      serversData.forEach((s) => {
        serversMap[s.id] = s;
      });
      setServers(serversMap);
      setFetchError(null);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      // Stores the dictionary key so the banner follows a language switch.
      setFetchError('migrations.error.title');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Refresh every 5 seconds for running migrations
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCancel = async (id: string) => {
    try {
      await cancelMigration(id);
      toast.success(t('migrations.toast.cancelled'));
      setCancelOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to cancel migration:', error);
      toast.error(t('migrations.toast.cancelFailed'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMigration(id);
      toast.success(t('migrations.toast.deleted'));
      setDeleteOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to delete migration:', error);
      toast.error(t('migrations.toast.deleteFailed'));
    }
  };

  const apiError = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

  const handleSuspendSource = async (m: Migration) => {
    try {
      await suspendMigrationSource(m.id);
      toast.success(t('migrations.toast.suspended', { name: m.account_username }));
      setSuspendOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to suspend source account:', error);
      toast.error(apiError(error, t('migrations.toast.suspendFailed')));
    }
  };

  const handleUnsuspendSource = async (m: Migration) => {
    try {
      await unsuspendMigrationSource(m.id);
      toast.success(t('migrations.toast.unsuspended', { name: m.account_username }));
      setUnsuspendOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to unsuspend source account:', error);
      toast.error(apiError(error, t('migrations.toast.unsuspendFailed')));
    }
  };

  const handleClear = async () => {
    try {
      const { deleted } = await clearFinishedMigrations();
      toast.success(t('migrations.toast.cleared', { count: deleted }));
      setClearOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to clear migrations:', error);
      toast.error(apiError(error, t('migrations.toast.clearFailed')));
    }
  };

  const handleDismissBatch = async (batchId: string) => {
    try {
      await dismissMigrationBatch(batchId);
      toast.success(t('batch.toast.dismissed'));
      setDismissOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to dismiss batch:', error);
      toast.error(apiError(error, t('batch.toast.dismissFailed')));
    }
  };

  // Tab counts are over individual non-batched migrations plus one unit per batch, so a batch of 50
  // counts as one row in the list it heads, not 50.
  const nonBatched = useMemo(() => migrations.filter((m) => !m.batch_id), [migrations]);
  const showLoadError = !loading && !!fetchError && migrations.length === 0;

  // Consolidated batches: migrations started together share a batch_id. Group them (latest attempt
  // per account, since a rerun lands in the same batch) so the operator gets ONE collapsed row that
  // opens the one-screen window for the whole batch, instead of its N separate rows.
  const batches = useMemo<BatchAgg[]>(() => {
    const groups = new Map<string, Migration[]>();
    for (const m of migrations) {
      if (!m.batch_id) continue;
      const arr = groups.get(m.batch_id);
      if (arr) arr.push(m);
      else groups.set(m.batch_id, [m]);
    }
    return [...groups.entries()]
      .map(([id, list]) => {
        const byAccount = new Map<string, Migration>();
        for (const m of list) {
          const prev = byAccount.get(m.account_username);
          if (!prev || new Date(m.created_at).getTime() >= new Date(prev.created_at).getTime()) byAccount.set(m.account_username, m);
        }
        const latest = [...byAccount.values()];
        let completed = 0;
        let failed = 0;
        let active = 0;
        let warnings = 0;
        let createdAt = list[0]?.created_at ?? '';
        for (const m of list) if (m.created_at < createdAt) createdAt = m.created_at;
        for (const m of latest) {
          if (m.status === 'completed') completed++;
          else if (m.status === 'failed' || m.status === 'cancelled') failed++;
          else active++;
          warnings += m.warnings ?? 0;
        }
        // Dismissed only when the whole batch is: a later rerun (no batch_dismissed_at) resurfaces it.
        const dismissed = list.every((m) => !!m.batch_dismissed_at);
        return { id, total: latest.length, completed, failed, active, warnings, createdAt, sourceId: list[0]?.source_server_id ?? '', targetId: list[0]?.target_server_id ?? '', dismissed };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [migrations]);

  const dismissedCount = useMemo(() => batches.filter((b) => b.dismissed).length, [batches]);

  // Count a batch (not each of its migrations) once, under the status its aggregate maps to.
  const batchStatus = (b: BatchAgg): StatusFilter => (b.active > 0 ? 'running' : b.failed > 0 ? 'failed' : 'completed');
  const runningCount = nonBatched.filter((m) => m.status === 'running').length + batches.filter((b) => b.active > 0).length;
  const completedCount = nonBatched.filter((m) => m.status === 'completed').length + batches.filter((b) => batchStatus(b) === 'completed').length;
  const failedCount = nonBatched.filter((m) => m.status === 'failed').length + batches.filter((b) => b.failed > 0).length;
  const finishedCount = migrations.filter((m) => m.status !== 'running' && m.status !== 'pending').length;
  const listCount = nonBatched.length + batches.filter((b) => showDismissed || !b.dismissed).length;

  // Collapsed list: one entry per batch (hidden when dismissed unless revealed) mixed with the
  // individual non-batched migrations, newest first, filtered by the active status tab.
  type Entry = { kind: 'batch'; batch: BatchAgg; createdAt: string } | { kind: 'migration'; migration: Migration; createdAt: string };
  const entries = useMemo<Entry[]>(() => {
    const batchEntries: Entry[] = batches
      .filter((b) => showDismissed || !b.dismissed)
      .filter((b) => filter === 'all' || batchStatus(b) === filter || (filter === 'failed' && b.failed > 0))
      .map((b) => ({ kind: 'batch', batch: b, createdAt: b.createdAt }));
    const migEntries: Entry[] = nonBatched
      .filter((m) => filter === 'all' || m.status === filter)
      .map((m) => ({ kind: 'migration', migration: m, createdAt: m.created_at }));
    return [...batchEntries, ...migEntries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, nonBatched, filter, showDismissed]);

  const sourceName = (m: Migration | null) => (m ? servers[m.source_server_id]?.name ?? t('migrations.dialog.sourceServer') : '');
  const account = (name?: string) => <Mono className="font-medium text-slate-900 dark:text-slate-100">{name}</Mono>;
  const server = (name: string) => <bdi className="font-medium text-slate-700 dark:text-slate-200">{name}</bdi>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('migrations.title')}
        description={t('migrations.description')}
        actions={
          <>
            {finishedCount > 0 && (
              <Button variant="secondary" leftIcon={<TrashIcon />} onClick={() => setClearOpen(true)}>
                {t('migrations.clearHistory')}
              </Button>
            )}
            <Button variant="primary" leftIcon={<PlusIcon />} onClick={() => navigate('/migrations/new')}>
              {t('nav.newMigration')}
            </Button>
          </>
        }
      />

      {fetchError && migrations.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
        >
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t(fetchError)}</p>
            <p className="mt-0.5 text-xs opacity-80">{t('migrations.error.stale')}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => fetchData()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      <Card flush className="motion-safe:animate-rise stagger" style={{ '--i': 1 } as CSSProperties}>
        <CardHeader
          divided
          actions={
            !loading && migrations.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {runningCount > 0 && (
                  <Badge tone="brand" size="sm" dot pulse glow>
                    {t('migrations.badge.running', { count: runningCount })}
                  </Badge>
                )}
                {dismissedCount > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setShowDismissed((v) => !v)}>
                    {showDismissed ? t('batch.list.hideDismissed') : t('batch.list.showDismissed', { count: dismissedCount })}
                  </Button>
                )}
                <Tabs<StatusFilter>
                  variant="pills"
                  size="sm"
                  value={filter}
                  onChange={setFilter}
                  tabs={[
                    { id: 'all', label: t('migrations.filter.all'), count: listCount },
                    { id: 'running', label: t('migrations.filter.running'), count: runningCount },
                    { id: 'completed', label: t('migrations.filter.completed'), count: completedCount },
                    { id: 'failed', label: t('migrations.filter.failed'), count: failedCount },
                  ]}
                />
              </div>
            ) : undefined
          }
        >
          <CardTitle>{t('migrations.card.title')}</CardTitle>
          <CardDescription>{t('migrations.card.description')}</CardDescription>
        </CardHeader>

        {loading ? (
          <SkeletonTable rows={6} columns={7} />
        ) : showLoadError ? (
          <EmptyState
            illustration="error"
            title={t('migrations.empty.load.title')}
            description={t('migrations.empty.load.description')}
            action={
              <Button variant="secondary" onClick={() => fetchData()}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : migrations.length === 0 ? (
          <EmptyState
            illustration="migrations"
            title={t('migrations.empty.title')}
            description={
              <ul className="mt-2 space-y-1 text-start">
                <li>{t('migrations.empty.b1')}</li>
                <li>{t('migrations.empty.b2')}</li>
                <li>{t('migrations.empty.b3')}</li>
              </ul>
            }
            action={
              <Button variant="primary" leftIcon={<PlusIcon />} onClick={() => navigate('/migrations/new')}>
                {t('nav.newMigration')}
              </Button>
            }
          />
        ) : entries.length === 0 ? (
          <EmptyState
            size="sm"
            illustration="search"
            title={filter === 'all' ? t('batch.list.allHandled') : t(`migrations.empty.${filter}.title`)}
            description={filter === 'all' ? t('batch.list.allHandledDesc') : t('migrations.empty.filter.description')}
            action={
              dismissedCount > 0 && !showDismissed ? (
                <Button variant="secondary" size="sm" onClick={() => setShowDismissed(true)}>
                  {t('batch.list.showDismissed', { count: dismissedCount })}
                </Button>
              ) : filter !== 'all' ? (
                <Button variant="secondary" size="sm" onClick={() => setFilter('all')}>
                  {t('common.showAll')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table bare stickyHeader maxHeight="75vh" className="[&_td]:px-3 [&_th]:px-3">
            <THead>
              <TR hoverable={false}>
                <TH>{t('migrations.col.account')}</TH>
                <TH>
                  <span className="inline-flex items-center gap-1">
                    {t('migrations.col.source')}
                    <ArrowRightIcon className="flip-rtl h-3 w-3 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                    {t('migrations.col.target')}
                  </span>
                </TH>
                <TH className="hidden 2xl:table-cell">{t('migrations.col.node')}</TH>
                <TH>{t('migrations.col.status')}</TH>
                <TH>{t('migrations.col.warnings')}</TH>
                <TH>{t('migrations.col.timing')}</TH>
                <TH align="end">
                  <span className="sr-only">{t('table.actions')}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {entries.map((entry) =>
                entry.kind === 'batch' ? (
                  <BatchListRow
                    key={`batch-${entry.batch.id}`}
                    batch={entry.batch}
                    source={servers[entry.batch.sourceId]}
                    target={servers[entry.batch.targetId]}
                    onOpen={() => navigate(`/migrations/batch/${entry.batch.id}`)}
                    onDismiss={() => {
                      setToDismiss(entry.batch.id);
                      setDismissOpen(true);
                    }}
                  />
                ) : (
                  <MigrationRow
                    key={entry.migration.id}
                    migration={entry.migration}
                    source={servers[entry.migration.source_server_id]}
                    target={servers[entry.migration.target_server_id]}
                    onView={() => navigate(`/migrations/${entry.migration.id}`)}
                    onCancel={() => {
                      setToCancel(entry.migration);
                      setCancelOpen(true);
                    }}
                    onDelete={() => {
                      setToDelete(entry.migration);
                      setDeleteOpen(true);
                    }}
                    onSuspendSource={() => {
                      setToSuspend(entry.migration);
                      setSuspendOpen(true);
                    }}
                    onUnsuspendSource={() => {
                      setToUnsuspend(entry.migration);
                      setUnsuspendOpen(true);
                    }}
                  />
                ),
              )}
            </TBody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        tone="warning"
        title={t('migrations.dialog.cancel.title')}
        message={t.rich('migrations.dialog.cancel.message', { account: account(toCancel?.account_username) })}
        confirmLabel={t('migrations.dialog.cancel.confirm')}
        cancelLabel={t('migrations.dialog.cancel.keep')}
        onConfirm={async () => {
          if (toCancel) await handleCancel(toCancel.id);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('migrations.dialog.delete.title')}
        message={t.rich('migrations.dialog.delete.message', { account: account(toDelete?.account_username) })}
        confirmLabel={t('migrations.dialog.delete.confirm')}
        onConfirm={async () => {
          if (toDelete) await handleDelete(toDelete.id);
        }}
      />

      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title={t('migrations.dialog.clear.title')}
        message={t('migrations.dialog.clear.message', { count: finishedCount })}
        confirmLabel={t('migrations.dialog.clear.confirm')}
        onConfirm={handleClear}
      />

      <ConfirmDialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        tone="warning"
        title={t('migrations.dialog.suspend.title')}
        message={t.rich('migrations.dialog.suspend.message', { account: account(toSuspend?.account_username), server: server(sourceName(toSuspend)) })}
        confirmLabel={t('migrations.dialog.suspend.confirm')}
        cancelLabel={t('migrations.dialog.suspend.notYet')}
        onConfirm={async () => {
          if (toSuspend) await handleSuspendSource(toSuspend);
        }}
      />

      <ConfirmDialog
        open={unsuspendOpen}
        onClose={() => setUnsuspendOpen(false)}
        tone="brand"
        title={t('migrations.dialog.unsuspend.title')}
        message={t.rich('migrations.dialog.unsuspend.message', { account: account(toUnsuspend?.account_username), server: server(sourceName(toUnsuspend)) })}
        confirmLabel={t('migrations.dialog.unsuspend.confirm')}
        onConfirm={async () => {
          if (toUnsuspend) await handleUnsuspendSource(toUnsuspend);
        }}
      />

      <ConfirmDialog
        open={dismissOpen}
        onClose={() => setDismissOpen(false)}
        tone="brand"
        title={t('batch.confirm.dismiss.title')}
        message={t('batch.confirm.dismiss.message')}
        confirmLabel={t('batch.confirm.dismiss.confirm')}
        onConfirm={async () => {
          if (toDismiss) await handleDismissBatch(toDismiss);
        }}
      />
    </div>
  );
}
