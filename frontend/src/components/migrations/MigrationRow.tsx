import { Link } from 'react-router-dom';
import { ArrowRightIcon, ExclamationTriangleIcon } from '@heroicons/react/16/solid';
import { StopIcon, TrashIcon } from '@heroicons/react/20/solid';
import { Badge, IconButton, ProgressBar, StatusBadge, TD, TDPrimary, TR, Tooltip } from '../ui';
import { formatDate, formatDuration, formatRelativeTime, percent, shortId } from '../../lib/format';
import type { Migration, Server } from '../../types';

export interface MigrationRowProps {
  migration: Migration;
  source?: Server;
  target?: Server;
  onView: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

/** One migration in the list table: account, route, node (xl+), status/progress, warnings, timing, actions. Click the row to open it. */
export function MigrationRow({ migration, source, target, onView, onCancel, onDelete }: MigrationRowProps) {
  const m = migration;
  const isRunning = m.status === 'running';
  const canCancel = m.status === 'running' || m.status === 'pending';
  const canDelete = m.status !== 'running';
  const warnings = m.warnings ?? 0;
  const timeRef = m.started_at ?? m.created_at;
  const timeLabel = m.started_at ? 'Started' : 'Created';
  // Only measure a duration that has a real end: a live one while running, or the recorded finish.
  const duration = m.started_at && (isRunning || m.completed_at) ? formatDuration(m.started_at, isRunning ? undefined : m.completed_at) : null;
  // The row itself is a keyboard-activatable button; keep inner controls from bubbling their keys to it.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <TR clickable onClick={onView}>
      <TDPrimary>
        <Link
          to={`/migrations/${m.id}`}
          onClick={stop}
          onKeyDown={stop}
          className="font-mono text-[13px] font-medium text-slate-900 transition-colors hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
        >
          {m.account_username}
        </Link>
        <div className="mt-0.5 font-mono text-2xs text-slate-400 dark:text-slate-500">{shortId(m.id)}</div>
      </TDPrimary>

      <TD>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <span className={source ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}>
            {source?.name ?? 'Unknown'}
          </span>
          <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          <span className={target ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}>
            {target?.name ?? 'Unknown'}
          </span>
        </div>
      </TD>

      <TD className="hidden xl:table-cell">
        {m.target_node || m.target_ip ? (
          <div className="whitespace-nowrap font-mono text-xs leading-tight">
            {m.target_node && <div className="text-slate-700 dark:text-slate-300">{m.target_node}</div>}
            {m.target_ip && <div className="text-slate-500 dark:text-slate-400">{m.target_ip}</div>}
          </div>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">—</span>
        )}
      </TD>

      <TD className="min-w-[180px]">
        <StatusBadge status={m.status} size="sm" />
        {isRunning && (
          <div className="mt-1.5 max-w-[220px]">
            <ProgressBar
              size="xs"
              value={percent(m.completed_steps, m.total_steps)}
              label={`Migration progress: ${m.completed_steps} of ${m.total_steps} steps`}
            />
            <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-slate-500 dark:text-slate-400">
              <span className="truncate" title={m.current_step}>
                {m.current_step || 'Working…'}
              </span>
              <span className="tabular shrink-0">
                {m.completed_steps}/{m.total_steps}
              </span>
            </div>
          </div>
        )}
        {m.status === 'failed' && m.error && (
          <div className="mt-1 max-w-[220px] truncate text-2xs text-rose-600 dark:text-rose-400" title={m.error}>
            {m.error}
          </div>
        )}
      </TD>

      <TD>
        {warnings > 0 ? (
          <Badge tone="warning" size="sm" icon={<ExclamationTriangleIcon />}>
            {warnings}
          </Badge>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">—</span>
        )}
      </TD>

      <TD muted className="whitespace-nowrap">
        <div title={formatDate(timeRef)}>
          <span className="text-slate-400 dark:text-slate-500">{timeLabel} </span>
          {formatRelativeTime(timeRef)}
        </div>
        {duration && (
          <div className="mt-0.5 font-mono text-2xs tabular text-slate-400 dark:text-slate-500">
            {isRunning ? 'running for ' : ''}
            {duration}
          </div>
        )}
      </TD>

      <TD align="right" onClick={stop} onKeyDown={stop} className="whitespace-nowrap">
        <div className="inline-flex items-center gap-0.5">
          {canCancel && (
            <Tooltip content="Cancel">
              <IconButton aria-label="Cancel migration" icon={<StopIcon />} size="sm" tone="danger" onClick={onCancel} />
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip content="Delete">
              <IconButton aria-label="Delete migration" icon={<TrashIcon />} size="sm" tone="danger" onClick={onDelete} />
            </Tooltip>
          )}
        </div>
      </TD>
    </TR>
  );
}

export default MigrationRow;
