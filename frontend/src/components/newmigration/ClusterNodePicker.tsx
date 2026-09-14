import { CheckIcon } from '@heroicons/react/16/solid';
import { InformationCircleIcon, MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { Badge, Button, EmptyState, Input, Mono, SkeletonCard, surfaceClasses } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import type { ClusterServer } from '../../api/client';

function nodeRoles(node: ClusterServer): string[] {
  if (node.roles && node.roles.length > 0) return node.roles;
  if (node.role) {
    return node.role
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
  }
  return [];
}

export interface ClusterNodeCardProps {
  node: ClusterServer;
  selected: boolean;
  onSelect: (node: ClusterServer) => void;
}

/** Selectable Enhance cluster node: friendly name, Main badge, mono ip/hostname, role badges. */
export function ClusterNodeCard({ node, selected, onSelect }: ClusterNodeCardProps) {
  const t = useT();
  const roles = nodeRoles(node);
  const title = node.friendly_name || node.hostname;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(node)}
      className={cn(
        surfaceClasses,
        'relative flex w-full flex-col gap-2 p-4 text-start transition-[transform,box-shadow,border-color,background-color] duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-brand-300 dark:focus-visible:ring-offset-slate-900',
        selected
          ? 'border-brand-500 bg-brand-50/40 ring-2 ring-brand-500/25 dark:border-brand-400 dark:bg-brand-500/[0.06] dark:ring-brand-400/25'
          : 'hover:-translate-y-px hover:border-slate-300 hover:shadow-pop dark:hover:border-white/[0.16] dark:hover:shadow-pop-dark motion-reduce:hover:translate-y-0',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
          {node.is_main && (
            <Badge tone="violet" size="sm">
              {t('newmigration.nodes.main')}
            </Badge>
          )}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-[opacity,transform] duration-200',
            selected ? 'bg-brand-700 text-white opacity-100 motion-safe:animate-scale-in dark:bg-brand-600' : 'scale-75 opacity-0',
          )}
        >
          <CheckIcon className="h-3.5 w-3.5" />
        </span>
      </span>
      <span className="block text-xs text-slate-700 dark:text-slate-300">
        {node.ip ? <Mono>{node.ip}</Mono> : <span className="text-slate-400 dark:text-slate-500">{t('newmigration.nodes.noIp')}</span>}
      </span>
      {node.hostname && node.hostname !== node.friendly_name && (
        <span className="block text-2xs text-slate-400 dark:text-slate-500">
          <Mono>{node.hostname}</Mono>
        </span>
      )}
      {roles.length > 0 && (
        <span className="flex flex-wrap gap-1 pt-0.5">
          {roles.map((role) => (
            <Badge key={role} tone="neutral" size="sm" mono>
              {role}
            </Badge>
          ))}
        </span>
      )}
    </button>
  );
}

export interface ClusterNodePickerProps {
  /** Filtered nodes to render. */
  nodes: ClusterServer[];
  /** All nodes in the cluster (for counts / the callout). */
  allNodes: ClusterServer[];
  selectedId: string;
  onSelect: (node: ClusterServer) => void;
  search: string;
  onSearchChange: (value: string) => void;
  loading?: boolean;
}

/**
 * Enhance cluster node picker: search, node cards and a callout stating
 * where the website will be created.
 */
export function ClusterNodePicker({ nodes, allNodes, selectedId, onSelect, search, onSearchChange, loading }: ClusterNodePickerProps) {
  const t = useT();
  const selected = allNodes.find((n) => n.id === selectedId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Input
            size="sm"
            leftIcon={<MagnifyingGlassIcon />}
            placeholder={t('newmigration.nodes.search')}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label={t('newmigration.nodes.searchAria')}
          />
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {loading ? t('newmigration.nodes.loading') : t('newmigration.nodes.inCluster', { nodes: t('units.nodes', { count: allNodes.length }) })}
        </span>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label={t('newmigration.nodes.loading')}>
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} lines={1} />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <EmptyState
          size="sm"
          illustration={allNodes.length === 0 ? 'servers' : 'search'}
          title={allNodes.length === 0 ? t('newmigration.nodes.empty.title') : t('newmigration.nodes.noMatch.title')}
          description={allNodes.length === 0 ? t('newmigration.nodes.empty.description') : t('newmigration.nodes.noMatch.description')}
          action={
            allNodes.length > 0 && search ? (
              <Button variant="secondary" size="sm" onClick={() => onSearchChange('')}>
                {t('newmigration.nodes.clearSearch')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid max-h-80 gap-3 overflow-y-auto p-1 sm:grid-cols-2 lg:grid-cols-3">
          {nodes.map((node) => (
            <ClusterNodeCard key={node.id} node={node} selected={selectedId === node.id} onSelect={onSelect} />
          ))}
        </div>
      )}

      <div
        className={cn(
          'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
          selected
            ? 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200'
            : 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
        )}
        role="status"
      >
        <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        {selected ? (
          <p>
            {t.rich('newmigration.nodes.callout.selected', {
              name: <span className="font-semibold">{selected.friendly_name || selected.hostname}</span>,
              ip: selected.ip ? (
                <span>
                  {' ('}
                  <Mono className="text-[13px]">{selected.ip}</Mono>
                  {')'}
                </span>
              ) : (
                ''
              ),
            })}
          </p>
        ) : (
          <p>{t('newmigration.nodes.callout.pick')}</p>
        )}
      </div>
    </div>
  );
}

export default ClusterNodePicker;
