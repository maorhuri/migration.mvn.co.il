import { CheckIcon } from '@heroicons/react/16/solid';
import { InformationCircleIcon, MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { CpuChipIcon } from '@heroicons/react/24/outline';
import { Badge, Button, EmptyState, Input, SkeletonCard } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ClusterServer } from '@/api/client';

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
  const roles = nodeRoles(node);
  const title = node.friendly_name || node.hostname;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(node)}
      className={cn(
        'relative flex w-full flex-col gap-2 rounded-xl border bg-white p-4 text-left shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-slate-900 dark:focus-visible:ring-offset-slate-900',
        selected
          ? 'border-indigo-500 ring-2 ring-indigo-500/25 dark:border-indigo-400 dark:ring-indigo-400/25'
          : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-600',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{title}</span>
          {node.is_main && (
            <Badge tone="violet" size="sm">
              Main
            </Badge>
          )}
        </span>
        {selected && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white dark:bg-indigo-500" aria-hidden="true">
            <CheckIcon className="h-3.5 w-3.5" />
          </span>
        )}
      </span>
      <span className="block font-mono text-xs text-slate-700 dark:text-slate-300">{node.ip || <span className="text-slate-400 dark:text-slate-500">no IP reported</span>}</span>
      {node.hostname && node.hostname !== node.friendly_name && (
        <span className="block truncate font-mono text-2xs text-slate-400 dark:text-slate-500">{node.hostname}</span>
      )}
      {roles.length > 0 && (
        <span className="flex flex-wrap gap-1 pt-0.5">
          {roles.map((role) => (
            <Badge key={role} tone="neutral" size="sm">
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
  const selected = allNodes.find((n) => n.id === selectedId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Input
            size="sm"
            leftIcon={<MagnifyingGlassIcon />}
            placeholder="Search by name, hostname or IP…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search cluster nodes"
          />
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {allNodes.length} node{allNodes.length === 1 ? '' : 's'} in this cluster
        </span>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading cluster nodes">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} lines={1} />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <EmptyState
          size="sm"
          icon={CpuChipIcon}
          title={allNodes.length === 0 ? 'No cluster nodes reported' : 'No nodes match'}
          description={allNodes.length === 0 ? 'The Enhance API returned no servers for this cluster.' : 'Try a different search term.'}
          action={
            allNodes.length > 0 && search ? (
              <Button variant="secondary" size="sm" onClick={() => onSearchChange('')}>
                Clear search
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
            The website will be created on <span className="font-semibold">{selected.friendly_name || selected.hostname}</span>
            {selected.ip && (
              <>
                {' '}
                (<span className="font-mono text-[13px]">{selected.ip}</span>)
              </>
            )}
            . Files are uploaded to this node over SSH and the hosts entry will point to its IP.
          </p>
        ) : (
          <p>Select the cluster node the website should be created on. Files are uploaded to that node and the hosts entry will point to its IP.</p>
        )}
      </div>
    </div>
  );
}

export default ClusterNodePicker;
