import { CheckIcon } from '@heroicons/react/16/solid';
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { MagnifyingGlassIcon as MagnifyingGlassOutlineIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import { Button, EmptyState, Input, PanelBadge, SkeletonCard, Tabs, panelTone, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Server } from '@/types';
import { PANEL_FILTER_OPTIONS } from './types';

const iconToneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  brand: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  danger: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  info: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  orange: 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300',
};

export interface ServerCardProps {
  server: Server;
  selected: boolean;
  onSelect: (server: Server) => void;
}

/** Selectable server tile: panel-tinted icon, name, PanelBadge and mono host. */
export function ServerCard({ server, selected, onSelect }: ServerCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(server)}
      className={cn(
        'group relative flex w-full items-start gap-3 rounded-xl border bg-white p-4 text-left shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-slate-900 dark:focus-visible:ring-offset-slate-900',
        selected
          ? 'border-indigo-500 ring-2 ring-indigo-500/25 dark:border-indigo-400 dark:ring-indigo-400/25'
          : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-600',
      )}
    >
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', iconToneClasses[panelTone(server.panel_type)])} aria-hidden="true">
        <ServerStackIcon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{server.name}</span>
          <PanelBadge panelType={server.panel_type} size="sm" />
        </span>
        <span className="mt-1 block truncate font-mono text-xs text-slate-500 dark:text-slate-400">
          {server.host}
          {server.port ? <span className="text-slate-400 dark:text-slate-500">:{server.port}</span> : null}
        </span>
      </span>
      {selected && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white dark:bg-indigo-500" aria-hidden="true">
          <CheckIcon className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}

export interface ServerPickerProps {
  /** Already filtered + searched servers to render. */
  servers: Server[];
  /** Total servers available before search/filter (drives the empty state copy). */
  totalCount: number;
  selectedId: string;
  onSelect: (server: Server) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filterType: string;
  onFilterTypeChange: (value: string) => void;
  loading?: boolean;
  /** Called from the "no servers yet" empty state. */
  onAddServer?: () => void;
  searchPlaceholder?: string;
}

/**
 * Toolbar (search + panel type filter) and a responsive grid of ServerCards,
 * with skeleton and empty states.
 */
export function ServerPicker({
  servers,
  totalCount,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  filterType,
  onFilterTypeChange,
  loading,
  onAddServer,
  searchPlaceholder = 'Search by name or host…',
}: ServerPickerProps) {
  const hasFilters = search.trim() !== '' || filterType !== 'all';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Input
            size="sm"
            leftIcon={<MagnifyingGlassIcon />}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search servers"
          />
        </div>
        <Tabs
          variant="pills"
          size="sm"
          value={filterType}
          onChange={onFilterTypeChange}
          tabs={PANEL_FILTER_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
          className="self-start overflow-x-auto scrollbar-none sm:self-auto"
        />
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading servers">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} lines={1} />
          ))}
        </div>
      ) : servers.length === 0 ? (
        totalCount === 0 ? (
          <EmptyState
            icon={ServerStackIcon}
            title="No servers yet"
            description="Add at least two servers (a source and a target) before starting a migration."
            action={
              onAddServer ? (
                <Button variant="primary" onClick={onAddServer}>
                  Add server
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={MagnifyingGlassOutlineIcon}
            title="No servers match"
            description="Try a different search term or clear the panel type filter."
            action={
              hasFilters ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    onSearchChange('');
                    onFilterTypeChange('all');
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} selected={selectedId === server.id} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

export default ServerPicker;
