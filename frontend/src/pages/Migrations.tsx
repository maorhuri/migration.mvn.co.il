import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowRightIcon } from '@heroicons/react/16/solid';
import { PlusIcon, TrashIcon } from '@heroicons/react/20/solid';
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
  SkeletonTable,
  Table,
  Tabs,
  TBody,
  TH,
  THead,
  TR,
} from '../components/ui';
import { MigrationRow } from '../components/migrations/MigrationRow';
import { useT } from '../lib/i18n';
import { getMigrations, getServers, cancelMigration, deleteMigration, clearFinishedMigrations, suspendMigrationSource, unsuspendMigrationSource } from '../api/client';
import type { Migration, Server } from '../types';

type StatusFilter = 'all' | 'running' | 'completed' | 'failed';

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

  const runningCount = migrations.filter((m) => m.status === 'running').length;
  const completedCount = migrations.filter((m) => m.status === 'completed').length;
  const failedCount = migrations.filter((m) => m.status === 'failed').length;
  const finishedCount = migrations.filter((m) => m.status !== 'running' && m.status !== 'pending').length;
  const showLoadError = !loading && !!fetchError && migrations.length === 0;
  const visible = filter === 'all' ? migrations : migrations.filter((m) => m.status === filter);

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
                <Tabs<StatusFilter>
                  variant="pills"
                  size="sm"
                  value={filter}
                  onChange={setFilter}
                  tabs={[
                    { id: 'all', label: t('migrations.filter.all'), count: migrations.length },
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
        ) : visible.length === 0 ? (
          <EmptyState
            size="sm"
            illustration="search"
            title={t(`migrations.empty.${filter}.title`)}
            description={t('migrations.empty.filter.description')}
            action={
              <Button variant="secondary" size="sm" onClick={() => setFilter('all')}>
                {t('common.showAll')}
              </Button>
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
              {visible.map((migration) => (
                <MigrationRow
                  key={migration.id}
                  migration={migration}
                  source={servers[migration.source_server_id]}
                  target={servers[migration.target_server_id]}
                  onView={() => navigate(`/migrations/${migration.id}`)}
                  onCancel={() => {
                    setToCancel(migration);
                    setCancelOpen(true);
                  }}
                  onDelete={() => {
                    setToDelete(migration);
                    setDeleteOpen(true);
                  }}
                  onSuspendSource={() => {
                    setToSuspend(migration);
                    setSuspendOpen(true);
                  }}
                  onUnsuspendSource={() => {
                    setToUnsuspend(migration);
                    setUnsuspendOpen(true);
                  }}
                />
              ))}
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
    </div>
  );
}
