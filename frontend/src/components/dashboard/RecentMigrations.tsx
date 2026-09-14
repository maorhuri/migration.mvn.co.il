import { Link, useNavigate } from 'react-router-dom';
import { ArrowRightIcon } from '@heroicons/react/16/solid';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  Mono,
  PanelMonogram,
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
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { formatDate, formatRelativeTime, realDate } from '../../lib/format';
import type { Migration, Server } from '../../types';

export interface RecentMigrationsProps {
  migrations: Migration[];
  servers: Server[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  className?: string;
}

const viewAllClasses =
  'inline-flex items-center gap-1 rounded-md text-sm font-medium text-brand-700 transition-colors hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200';

/** One end of the route: panel monogram + server name (LTR mono, since names are hostnames). */
function RouteEnd({ server, fallback }: { server: Server | undefined; fallback: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <PanelMonogram panelType={server?.panel_type} size="sm" />
      {server ? (
        <Mono className="max-w-[10rem] text-xs text-slate-700 dark:text-slate-300">{server.name}</Mono>
      ) : (
        <span className="text-xs text-slate-400 dark:text-slate-500">{fallback}</span>
      )}
    </span>
  );
}

/** Card listing the latest migrations with resolved source and target servers. */
export function RecentMigrations({ migrations, servers, loading, error, onRetry, className }: RecentMigrationsProps) {
  const t = useT();
  const navigate = useNavigate();
  const serverById = (id: string) => servers.find((s) => s.id === id);
  const na = t('common.notAvailable');

  return (
    <Card flush className={cn('overflow-hidden', className)}>
      <CardHeader
        divided
        actions={
          <Link to="/migrations" className={viewAllClasses}>
            {t('common.viewAll')}
            <ArrowRightIcon className="flip-rtl h-4 w-4" aria-hidden="true" />
          </Link>
        }
      >
        <CardTitle>{t('dashboard.recent.title')}</CardTitle>
        <CardDescription>{t('dashboard.recent.description')}</CardDescription>
      </CardHeader>

      {loading ? (
        <SkeletonTable rows={5} columns={5} />
      ) : error && migrations.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="error"
          title={t('dashboard.recent.error.title')}
          description={t('empty.couldNotLoad.description')}
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : migrations.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="migrations"
          title={t('dashboard.recent.empty.title')}
          description={t('dashboard.recent.empty.description')}
          action={
            <Button variant="primary" size="sm" onClick={() => navigate('/migrations/new')}>
              {t('nav.newMigration')}
            </Button>
          }
        />
      ) : (
        <Table bare>
          <THead>
            <TR hoverable={false}>
              <TH>{t('dashboard.recent.col.account')}</TH>
              <TH>{t('dashboard.recent.col.route')}</TH>
              <TH>{t('dashboard.recent.col.status')}</TH>
              <TH>{t('dashboard.recent.col.target')}</TH>
              <TH align="end">{t('dashboard.recent.col.started')}</TH>
            </TR>
          </THead>
          <TBody>
            {migrations.map((m) => {
              const source = serverById(m.source_server_id);
              const target = serverById(m.target_server_id);
              const targetValue = m.target_node || m.target_ip;
              const started = realDate(m.started_at) ?? m.created_at;
              return (
                <TR key={m.id} clickable onClick={() => navigate(`/migrations/${m.id}`)}>
                  <TDPrimary className="text-[13px]">
                    <Mono>{m.account_username}</Mono>
                  </TDPrimary>
                  <TD>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <RouteEnd server={source} fallback={na} />
                      <ArrowRightIcon className="flip-rtl h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                      <RouteEnd server={target} fallback={na} />
                    </span>
                  </TD>
                  <TD>
                    <StatusBadge status={m.status} size="sm" label={m.status === 'running' && m.current_step ? m.current_step : undefined} />
                  </TD>
                  <TD muted={!targetValue}>{targetValue ? <Mono className="text-xs">{targetValue}</Mono> : na}</TD>
                  <TD align="end" muted className="whitespace-nowrap tabular" title={formatDate(started)}>
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
