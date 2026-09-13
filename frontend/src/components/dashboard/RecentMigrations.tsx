import { Link, useNavigate } from 'react-router-dom';
import { ArrowsRightLeftIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { ArrowRightIcon } from '@heroicons/react/16/solid';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  SkeletonTable,
  StatusBadge,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  TDPrimary,
} from '../ui';
import { formatDate, formatRelativeTime, realDate } from '../../lib/format';
import type { Migration, Server } from '../../types';

export interface RecentMigrationsProps {
  migrations: Migration[];
  servers: Server[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

const viewAllClasses =
  'inline-flex items-center gap-1 rounded-md text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300';

/** Card listing the latest migrations with resolved source → target names. */
export function RecentMigrations({ migrations, servers, loading, error, onRetry }: RecentMigrationsProps) {
  const navigate = useNavigate();
  const serverName = (id: string) => servers.find((s) => s.id === id)?.name;

  return (
    <Card flush className="overflow-hidden xl:col-span-2">
      <CardHeader
        divided
        actions={
          <Link to="/migrations" className={viewAllClasses}>
            View all
            <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      >
        <CardTitle>Recent migrations</CardTitle>
        <CardDescription>Latest account moves across the fleet.</CardDescription>
      </CardHeader>

      {loading ? (
        <SkeletonTable rows={5} columns={5} />
      ) : error && migrations.length === 0 ? (
        <EmptyState
          size="sm"
          icon={ExclamationCircleIcon}
          title="Could not load migrations"
          description="The API did not respond. Check that the backend is running and try again."
          action={<Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>}
        />
      ) : migrations.length === 0 ? (
        <EmptyState
          size="sm"
          icon={ArrowsRightLeftIcon}
          title="No migrations yet"
          description="Start a migration to move an account between servers."
          action={<Button variant="primary" size="sm" onClick={() => navigate('/migrations/new')}>New migration</Button>}
        />
      ) : (
        <Table bare>
          <THead>
            <TR hoverable={false}>
              <TH>Account</TH>
              <TH>Route</TH>
              <TH>Status</TH>
              <TH>Target</TH>
              <TH align="right">Started</TH>
            </TR>
          </THead>
          <TBody>
            {migrations.map((m) => {
              const source = serverName(m.source_server_id);
              const target = serverName(m.target_server_id);
              const targetValue = m.target_node || m.target_ip;
              const started = realDate(m.started_at) ?? m.created_at;
              return (
                <TR key={m.id} clickable onClick={() => navigate(`/migrations/${m.id}`)}>
                  <TDPrimary mono className="text-[13px]">{m.account_username}</TDPrimary>
                  <TD>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <span className="text-slate-700 dark:text-slate-300">{source ?? '—'}</span>
                      <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                      <span className="text-slate-700 dark:text-slate-300">{target ?? '—'}</span>
                    </span>
                  </TD>
                  <TD>
                    <StatusBadge status={m.status} size="sm" label={m.status === 'running' && m.current_step ? m.current_step : undefined} />
                  </TD>
                  <TD mono muted={!targetValue}>{targetValue ?? '—'}</TD>
                  <TD align="right" muted className="whitespace-nowrap" title={formatDate(started)}>
                    {formatRelativeTime(started)}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

export default RecentMigrations;
