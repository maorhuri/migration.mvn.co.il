import { CheckIcon } from '@heroicons/react/16/solid';
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { Button, EmptyState, Input, Mono, PanelBadge, PanelMonogram, SkeletonCard, Tabs, surfaceClasses } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { isAgentlessPanel, serverSiteUrl } from '../../lib/agentless';
import type { Server } from '../../types';
import { PANEL_FILTER_OPTIONS } from './types';

export interface ServerCardProps {
  server: Server;
  selected: boolean;
  onSelect: (server: Server) => void;
}

/** Selectable server tile: panel monogram, name, PanelBadge and the mono host:port (site URL for FTP / WordPress sources). */
export function ServerCard({ server, selected, onSelect }: ServerCardProps) {
  const t = useT();
  const siteUrl = isAgentlessPanel(server.panel_type) ? serverSiteUrl(server) : '';
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(server)}
      className={cn(
        surfaceClasses,
        'group relative flex w-full items-start gap-3 p-4 text-start transition-[transform,box-shadow,border-color,background-color] duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-brand-300 dark:focus-visible:ring-offset-slate-900',
        selected
          ? 'border-brand-500 bg-brand-50/40 ring-2 ring-brand-500/25 dark:border-brand-400 dark:bg-brand-500/[0.06] dark:ring-brand-400/25'
          : 'hover:-translate-y-px hover:border-slate-300 hover:shadow-pop dark:hover:border-white/[0.16] dark:hover:shadow-pop-dark motion-reduce:hover:translate-y-0',
      )}
    >
      <PanelMonogram panelType={server.panel_type} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{server.name}</span>
          <PanelBadge panelType={server.panel_type} size="sm" />
        </span>
        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
          {siteUrl ? (
            <Mono>{siteUrl}</Mono>
          ) : (
            <Mono>
              {server.host}
              {server.port ? <span className="text-slate-400 dark:text-slate-500">:{server.port}</span> : null}
            </Mono>
          )}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-[opacity,transform] duration-200',
          selected ? 'bg-brand-700 text-white opacity-100 motion-safe:animate-scale-in dark:bg-brand-600' : 'scale-75 opacity-0',
        )}
        title={selected ? t('newmigration.picker.selected') : undefined}
      >
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
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
  searchPlaceholder,
}: ServerPickerProps) {
  const t = useT();
  const hasFilters = search.trim() !== '' || filterType !== 'all';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Input
            size="sm"
            leftIcon={<MagnifyingGlassIcon />}
            placeholder={searchPlaceholder ?? t('newmigration.picker.search')}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label={t('newmigration.picker.searchAria')}
          />
        </div>
        <Tabs
          variant="pills"
          size="sm"
          value={filterType}
          onChange={onFilterTypeChange}
          tabs={PANEL_FILTER_OPTIONS.map((o) => ({ id: o.id, label: t(o.labelKey) }))}
          className="self-start overflow-x-auto scrollbar-none sm:self-auto"
        />
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label={t('newmigration.picker.loading')}>
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} lines={1} />
          ))}
        </div>
      ) : servers.length === 0 ? (
        totalCount === 0 ? (
          <EmptyState
            illustration="servers"
            title={t('newmigration.picker.empty.title')}
            description={t('newmigration.picker.empty.description')}
            action={
              onAddServer ? (
                <Button variant="primary" onClick={onAddServer}>
                  {t('newmigration.picker.empty.action')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            illustration="search"
            title={t('newmigration.picker.noMatch.title')}
            description={t('newmigration.picker.noMatch.description')}
            action={
              hasFilters ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    onSearchChange('');
                    onFilterTypeChange('all');
                  }}
                >
                  {t('common.clearFilters')}
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
