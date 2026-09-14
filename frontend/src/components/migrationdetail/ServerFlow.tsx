import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ServerStackIcon } from '@heroicons/react/24/outline';
import { Card, CardTitle, EmptyState, KeyValue, PanelBadge, PanelMonogram, Wire, panelTone, type WireStatus } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import type { Migration, Server } from '../../types';

export interface ServerFlowProps {
  source: Server | null;
  target: Server | null;
  migration: Migration;
  className?: string;
  style?: CSSProperties;
}

function wireStatus(status: Migration['status']): WireStatus {
  switch (status) {
    case 'running':
    case 'awaiting_review':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

interface ServerCardProps {
  role: string;
  server: Server | null;
  /** Enhance cluster node the site actually lives on (target side only). */
  node?: { name?: string; ip: string } | null;
}

function ServerCard({ role, server, node }: ServerCardProps) {
  const t = useT();
  return (
    <Card edge={server ? panelTone(server.panel_type) : 'neutral'} className="h-full min-w-0">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">{role}</p>
        {server && <PanelBadge panelType={server.panel_type} size="sm" />}
      </div>
      {server ? (
        <>
          <div className="mt-2 flex items-center gap-3">
            <PanelMonogram panelType={server.panel_type} size="md" />
            <CardTitle as="h3" className="min-w-0 flex-1 break-words leading-snug">
              <Link to={`/servers/${server.id}`} className="rounded transition-colors hover:text-brand-700 dark:hover:text-brand-300">
                {server.name}
              </Link>
            </CardTitle>
          </div>
          <KeyValue
            divided
            className="mt-4"
            items={[
              { label: t('migrationdetail.flow.host'), value: server.host, mono: true },
              { label: t('migrationdetail.flow.port'), value: server.port, mono: true },
              { label: t('migrationdetail.flow.user'), value: server.username, mono: true },
            ]}
          />
          {node && (
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
              <p className="eyebrow">{t('migrationdetail.flow.node')}</p>
              {/* Wrapping LTR spans rather than Mono: a long node hostname must not lose its tail in a narrow card. */}
              {node.name && (
                <span dir="ltr" className="ltr mt-0.5 block break-all font-mono text-xs font-medium text-slate-900 dark:text-slate-100">
                  {node.name}
                </span>
              )}
              <span dir="ltr" className="ltr block font-mono text-xs text-slate-500 dark:text-slate-400">
                {node.ip}
              </span>
            </div>
          )}
        </>
      ) : (
        <EmptyState size="sm" icon={ServerStackIcon} title={t('migrationdetail.flow.missing.title')} description={t('migrationdetail.flow.missing.description')} />
      )}
    </Card>
  );
}

/** Source and target cards joined by a Wire that carries the run state. Stacks under lg. */
export function ServerFlow({ source, target, migration, className, style }: ServerFlowProps) {
  const t = useT();
  return (
    <div className={cn('grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch', className)} style={style}>
      <ServerCard role={t('migrationdetail.flow.source')} server={source} />
      <div className="flex items-center justify-center">
        <Wire status={wireStatus(migration.status)} />
      </div>
      <ServerCard
        role={t('migrationdetail.flow.target')}
        server={target}
        node={migration.target_ip ? { name: migration.target_node, ip: migration.target_ip } : null}
      />
    </div>
  );
}

export default ServerFlow;
