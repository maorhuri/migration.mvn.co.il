import type { ReactNode } from 'react';
import { ServerStackIcon } from '@heroicons/react/24/outline';
import { ArrowPathIcon, ArrowRightIcon, PencilSquareIcon, SignalIcon, TrashIcon } from '@heroicons/react/20/solid';
import { Badge, Button, Card, IconButton, PanelBadge, Tooltip, panelTone, type BadgeTone } from '../ui';
import { cn } from '../../lib/cn';
import { formatDate, formatRelativeTime } from '../../lib/format';
import type { Server } from '../../types';

export const AUTH_METHOD_LABELS: Record<Server['auth_method'], string> = {
  password: 'Password',
  ssh_key: 'SSH key',
  api_key: 'API key',
};

/** Tinted icon box per panel tone (light + dark pairs). */
const ICON_TINT: Record<BadgeTone, string> = {
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
  testing: boolean;
  refreshing: boolean;
  onTest: () => void;
  onRefresh: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] text-slate-700 dark:text-slate-300">{children}</dd>
    </div>
  );
}

export function ServerCard({ server, testing, refreshing, onTest, onRefresh, onView, onEdit, onDelete }: ServerCardProps) {
  const tone = panelTone(server.panel_type);

  return (
    <Card className="flex flex-col" data-testid={`server-card-${server.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', ICON_TINT[tone])}>
            <ServerStackIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100" title={server.name}>
              {server.name}
            </h3>
            <div className="mt-1">
              <PanelBadge panelType={server.panel_type} size="sm" />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {server.panel_type !== 'enhance' && (
            <Tooltip content="Refresh accounts">
              <IconButton
                aria-label={`Refresh accounts for ${server.name}`}
                icon={<ArrowPathIcon />}
                size="sm"
                tone="success"
                loading={refreshing}
                onClick={onRefresh}
              />
            </Tooltip>
          )}
          <Tooltip content="Edit server">
            <IconButton aria-label={`Edit ${server.name}`} icon={<PencilSquareIcon />} size="sm" tone="brand" onClick={onEdit} />
          </Tooltip>
          <Tooltip content="Delete server">
            <IconButton aria-label={`Delete ${server.name}`} icon={<TrashIcon />} size="sm" tone="danger" onClick={onDelete} />
          </Tooltip>
        </div>
      </div>

      <dl className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
        <Row label="Host">
          <span className="block truncate font-mono text-slate-900 dark:text-slate-100" title={`${server.host}:${server.port}`}>
            {server.host}
            <span className="text-slate-400 dark:text-slate-500">:{server.port}</span>
          </span>
        </Row>
        <Row label="User">
          <span className="font-mono">{server.username}</span>
        </Row>
        <Row label="Auth">
          <Badge tone="neutral" size="sm">
            {AUTH_METHOD_LABELS[server.auth_method] ?? server.auth_method}
          </Badge>
        </Row>
        <Row label="Added">
          <span title={formatDate(server.created_at)}>{formatRelativeTime(server.created_at)}</span>
        </Row>
      </dl>

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <Button variant="secondary" size="sm" leftIcon={<SignalIcon />} loading={testing} onClick={onTest} className="flex-1">
          Test connection
        </Button>
        <Button variant="ghost" size="sm" rightIcon={<ArrowRightIcon />} onClick={onView} className="flex-1">
          View details
        </Button>
      </div>
    </Card>
  );
}

export default ServerCard;
