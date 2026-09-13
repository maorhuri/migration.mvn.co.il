import { Link } from 'react-router-dom';
import { ArrowDownIcon, ArrowRightIcon } from '@heroicons/react/20/solid';
import { ServerStackIcon } from '@heroicons/react/24/outline';
import { Card, CardTitle, EmptyState, KeyValue, PanelBadge, panelTone, type CardProps } from '../ui';
import type { Migration, Server } from '../../types';

interface ServerFlowProps {
  source: Server | null;
  target: Server | null;
  migration: Migration;
}

type Accent = NonNullable<CardProps['accent']>;

function accentFor(server: Server | null): Accent | undefined {
  const tone = panelTone(server?.panel_type);
  return tone === 'neutral' ? undefined : (tone as Accent);
}

interface ServerCardProps {
  role: 'Source' | 'Target';
  server: Server | null;
  node?: { name?: string; ip: string } | null;
}

function ServerCard({ role, server, node }: ServerCardProps) {
  return (
    <Card accent={accentFor(server)} className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{role} server</p>
      {server ? (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <CardTitle as="h3" className="truncate">
              <Link
                to={`/servers/${server.id}`}
                className="rounded transition-colors hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                {server.name}
              </Link>
            </CardTitle>
            <PanelBadge panelType={server.panel_type} size="sm" />
          </div>
          <KeyValue
            divided
            className="mt-4"
            items={[
              { label: 'Host', value: server.host, mono: true },
              { label: 'Port', value: server.port, mono: true },
              { label: 'User', value: server.username, mono: true },
              ...(node
                ? [{ label: 'Cluster node', value: `${node.name ? `${node.name} ` : ''}(${node.ip})`, mono: true }]
                : []),
            ]}
          />
        </>
      ) : (
        <EmptyState size="sm" icon={ServerStackIcon} title="Server details not available" description="The server may have been removed." />
      )}
    </Card>
  );
}

/** Source → Target flow row. Stacks vertically on small screens. */
export function ServerFlow({ source, target, migration }: ServerFlowProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
      <ServerCard role="Source" server={source} />
      <div className="flex items-center justify-center lg:px-1" aria-hidden="true">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
          <ArrowDownIcon className="h-5 w-5 lg:hidden" />
          <ArrowRightIcon className="hidden h-5 w-5 lg:block" />
        </span>
      </div>
      <ServerCard
        role="Target"
        server={target}
        node={migration.target_ip ? { name: migration.target_node, ip: migration.target_ip } : null}
      />
    </div>
  );
}

export default ServerFlow;
