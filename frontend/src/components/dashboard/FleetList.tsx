import { Link, useNavigate } from 'react-router-dom';
import { ArrowRightIcon, ChevronRightIcon } from '@heroicons/react/16/solid';
import { Button, Card, CardHeader, CardTitle, CardDescription, EmptyState, Mono, PanelMonogram, Skeleton, usePanelLabel } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import type { Migration, Server } from '../../types';

export interface FleetListProps {
  servers: Server[];
  /** Used to count the accounts each server sent out / received (derived, no extra request). */
  migrations?: Migration[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** Cap the number of rows shown; the header links to the full list. */
  limit?: number;
  className?: string;
}

const viewAllClasses =
  'inline-flex items-center gap-1 rounded-md text-sm font-medium text-brand-700 transition-colors hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200';

/** Card listing the servers in the fleet: panel monogram, name, host and the accounts it moved. */
export function FleetList({ servers, migrations = [], loading, error, onRetry, limit = 8, className }: FleetListProps) {
  const t = useT();
  const navigate = useNavigate();
  const panelLabel = usePanelLabel();
  const visible = servers.slice(0, limit);

  /** Enhance receives accounts; every other panel is a source that sends them. */
  const moved = (s: Server): { count: number; label: string } => {
    const incoming = s.panel_type === 'enhance';
    const count = migrations.filter((m) => (incoming ? m.target_server_id : m.source_server_id) === s.id).length;
    return { count, label: incoming ? t('dashboard.fleet.movedIn') : t('dashboard.fleet.movedOut') };
  };

  return (
    <Card flush className={cn('overflow-hidden xl:self-start', className)}>
      <CardHeader
        divided
        actions={
          <Link to="/servers" className={viewAllClasses}>
            {t('common.viewAll')}
            <ArrowRightIcon className="flip-rtl h-4 w-4" aria-hidden="true" />
          </Link>
        }
      >
        <CardTitle>{t('dashboard.fleet.title')}</CardTitle>
        <CardDescription>
          {loading
            ? t('dashboard.fleet.loading')
            : error && servers.length === 0
              ? t('dashboard.fleet.unavailable')
              : t('dashboard.fleet.connected', { count: servers.length })}
        </CardDescription>
      </CardHeader>

      {loading ? (
        <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]" role="status" aria-label={t('a11y.loadingX', { name: t('nav.servers') })}>
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-6 py-3">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            </li>
          ))}
        </ul>
      ) : error && servers.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="error"
          title={t('dashboard.fleet.error.title')}
          description={t('empty.couldNotLoad.description')}
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : servers.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="servers"
          title={t('dashboard.fleet.empty.title')}
          description={t('dashboard.fleet.empty.description')}
          action={
            <Button variant="primary" size="sm" onClick={() => navigate('/servers')}>
              {t('dashboard.addServer')}
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
          {visible.map((s) => (
            <li key={s.id}>
              <Link
                to={`/servers/${s.id}`}
                className="group flex items-center gap-3 px-6 py-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-white/[0.03] dark:focus-visible:bg-white/[0.04]"
              >
                <PanelMonogram panelType={s.panel_type} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    <bdi dir="auto">{s.name}</bdi>
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400" title={panelLabel(s.panel_type)}>
                    <Mono className="text-xs">
                      {s.host}
                      {s.port ? <span className="text-slate-400 dark:text-slate-500">:{s.port}</span> : null}
                    </Mono>
                  </p>
                </div>
                {(() => {
                  const { count, label } = moved(s);
                  return (
                    // In the three-column dashboard grid the card is narrowest between xl and ~1400px: give the host line the room.
                    <span className="hidden shrink-0 text-end sm:block xl:hidden min-[1400px]:block">
                      <span className={cn('block text-base font-semibold leading-none tabular', count > 0 ? 'text-slate-900 dark:text-slate-100' : 'text-slate-300 dark:text-slate-600')}>
                        {count}
                      </span>
                      <span className="mt-1 block text-2xs text-slate-500 dark:text-slate-400">{label}</span>
                    </span>
                  );
                })()}
                <ChevronRightIcon
                  className="flip-rtl h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-brand-700 dark:text-slate-600 dark:group-hover:text-brand-300"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
          {servers.length > visible.length && (
            <li className="px-6 py-2.5 text-center text-xs text-slate-500 dark:text-slate-400">
              <Link to="/servers" className="font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200">
                {t('dashboard.fleet.more', { count: servers.length - visible.length })}
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

export default FleetList;
