import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PlusIcon } from '@heroicons/react/20/solid';
import { ArrowsRightLeftIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  SkeletonTable,
  Table,
  TBody,
  TH,
  THead,
  TR,
} from '../components/ui';
import { MigrationRow } from '../components/migrations/MigrationRow';
import { getMigrations, getServers, cancelMigration, deleteMigration } from '../api/client';
import type { Migration, Server } from '../types';

export default function Migrations() {
  const navigate = useNavigate();
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [servers, setServers] = useState<Record<string, Server>>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Dialog targets are kept after close so the message does not blank during the exit transition.
  const [toCancel, setToCancel] = useState<Migration | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Migration | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
      setFetchError('Could not load migrations. Retrying automatically.');
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
      toast.success('Migration cancelled');
      setCancelOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to cancel migration:', error);
      toast.error('Failed to cancel migration');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMigration(id);
      toast.success('Migration deleted');
      setDeleteOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to delete migration:', error);
      toast.error('Failed to delete migration');
    }
  };

  const runningCount = migrations.filter((m) => m.status === 'running').length;
  const showLoadError = !loading && !!fetchError && migrations.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Migrations"
        description="View and manage account migrations between servers."
        actions={
          <Button variant="primary" leftIcon={<PlusIcon />} onClick={() => navigate('/migrations/new')}>
            New migration
          </Button>
        }
      />

      {fetchError && migrations.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
        >
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{fetchError}</p>
            <p className="mt-0.5 text-xs opacity-80">Showing the last data that loaded successfully.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => fetchData()}>
            Retry
          </Button>
        </div>
      )}

      <Card flush>
        <CardHeader
          divided
          actions={
            !loading && migrations.length > 0 ? (
              <div className="flex items-center gap-2">
                {runningCount > 0 && (
                  <Badge tone="brand" size="sm" dot pulse>
                    {runningCount} running
                  </Badge>
                )}
                <Badge tone="neutral" size="sm">
                  {migrations.length} total
                </Badge>
              </div>
            ) : undefined
          }
        >
          <CardTitle>All migrations</CardTitle>
          <CardDescription>Refreshes automatically every 5 seconds.</CardDescription>
        </CardHeader>

        {loading ? (
          <SkeletonTable rows={6} columns={7} />
        ) : showLoadError ? (
          <EmptyState
            icon={ExclamationTriangleIcon}
            title="Could not load migrations"
            description="The API did not respond. It is retried every 5 seconds, or you can retry now."
            action={
              <Button variant="secondary" onClick={() => fetchData()}>
                Retry
              </Button>
            }
          />
        ) : migrations.length === 0 ? (
          <EmptyState
            icon={ArrowsRightLeftIcon}
            title="No migrations yet"
            description="Start your first migration to move an account between servers."
            action={
              <Button variant="primary" leftIcon={<PlusIcon />} onClick={() => navigate('/migrations/new')}>
                New migration
              </Button>
            }
          />
        ) : (
          <Table bare stickyHeader maxHeight="75vh">
            <THead>
              <TR hoverable={false}>
                <TH>Account</TH>
                <TH>Source → Target</TH>
                <TH className="hidden xl:table-cell">Node</TH>
                <TH>Status</TH>
                <TH>Warnings</TH>
                <TH>Timing</TH>
                <TH align="right">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {migrations.map((migration) => (
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
        title="Cancel this migration?"
        message={
          <>
            The migration of <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{toCancel?.account_username}</span> will
            stop at its current step. Files already copied to the target are left in place.
          </>
        }
        confirmLabel="Cancel migration"
        cancelLabel="Keep running"
        onConfirm={async () => {
          if (toCancel) await handleCancel(toCancel.id);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this migration?"
        message={
          <>
            This permanently removes the migration record and logs for{' '}
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{toDelete?.account_username}</span>. The account on the
            target server is not affected.
          </>
        }
        confirmLabel="Delete migration"
        onConfirm={async () => {
          if (toDelete) await handleDelete(toDelete.id);
        }}
      />
    </div>
  );
}

