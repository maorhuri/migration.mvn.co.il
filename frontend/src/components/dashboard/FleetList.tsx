import { Link, useNavigate } from 'react-router-dom';
import { ExclamationCircleIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import { ArrowRightIcon, ChevronRightIcon } from '@heroicons/react/16/solid';
import { Button, Card, CardHeader, CardTitle, CardDescription, EmptyState, PanelBadge, Skeleton } from '../ui';
import type { Server } from '../../types';

export interface FleetListProps {
  servers: Server[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** Cap the number of rows shown; the header links to the full list. */
  limit?: number;
}

const viewAllClasses =
  'inline-flex items-center gap-1 rounded-md text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300';

/** Card listing the servers in the fleet: panel badge, name, host. */
export function FleetList({ servers, loading, error, onRetry, limit = 8 }: FleetListProps) {
  const navigate = useNavigate();
  const visible = servers.slice(0, limit);

  return (
    <Card flush className="overflow-hidden">
      <CardHeader
        divided
        actions={
          <Link to="/servers" className={viewAllClasses}>
            View all
            <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      >
        <CardTitle>Fleet</CardTitle>
        <CardDescription>
          {loading
            ? 'Loading servers…'
            : error && servers.length === 0
              ? 'Server list unavailable'
              : `${servers.length} server${servers.length === 1 ? '' : 's'} connected`}
        </CardDescription>
      </CardHeader>

      {loading ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="status" aria-label="Loading servers">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-3 sm:px-6">
              <Skeleton className="h-5 w-16" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-36" />
              </div>
            </li>
          ))}
        </ul>
      ) : error && servers.length === 0 ? (
        <EmptyState
          size="sm"
          icon={ExclamationCircleIcon}
          title="Could not load servers"
          description="The API did not respond. Check that the backend is running and try again."
          action={<Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>}
        />
      ) : servers.length === 0 ? (
        <EmptyState
          size="sm"
          icon={ServerStackIcon}
          title="No servers yet"
          description="Add a source or target server to start migrating."
          action={<Button variant="primary" size="sm" onClick={() => navigate('/servers')}>Add server</Button>}
        />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {visible.map((s) => (
            <li key={s.id}>
              <Link
                to={`/servers/${s.id}`}
                className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-slate-800/50 dark:focus-visible:bg-slate-800/50 sm:px-6"
              >
                <PanelBadge panelType={s.panel_type} size="sm" className="w-24 shrink-0 justify-center" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{s.name}</p>
                  <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                    {s.host}
                    {s.port ? <span className="text-slate-400 dark:text-slate-500">:{s.port}</span> : null}
                  </p>
                </div>
                <ChevronRightIcon
                  className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
          {servers.length > visible.length && (
            <li className="px-5 py-2.5 text-center text-xs text-slate-500 dark:text-slate-400 sm:px-6">
              +{servers.length - visible.length} more in{' '}
              <Link to="/servers" className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300">
                Servers
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

export default FleetList;
