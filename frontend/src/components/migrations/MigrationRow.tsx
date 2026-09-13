import { Link } from 'react-router-dom';
import { ArrowRightIcon, ExclamationTriangleIcon } from '@heroicons/react/16/solid';
import { PauseCircleIcon, PlayCircleIcon, StopIcon, TrashIcon } from '@heroicons/react/20/solid';
import { Badge, Button, IconButton, ProgressBar, StatusBadge, TD, TDPrimary, TR, Tooltip } from '../ui';
import { formatDate, formatDuration, formatRelativeTime, percent, realDate, shortId } from '../../lib/format';
import type { Migration, Server } from '../../types';

export interface MigrationRowProps {
  migration: Migration;
  source?: Server;
  target?: Server;
  onView: () => void;
  onCancel: () => void;
  onDelete: () => void;
  /** Suspend the account on the source panel (only offered for completed migrations). */
  onSuspendSource: () => void;
  onUnsuspendSource: () => void;
}

/** One migration in the list table: account, route, node (xl+), status/progress, warnings, timing, actions. Click the row to open it. */
export function MigrationRow({ migration, source, target, onView, onCancel, onDelete, onSuspendSource, onUnsuspendSource }: MigrationRowProps) {
  const m = migration;
  const isRunning = m.status === 'running';
  const canCancel = m.status === 'running' || m.status === 'pending';
  const canDelete = m.status !== 'running';
  const isCompleted = m.status === 'completed';
  const sourceSuspended = !!m.source_suspended_at;
  const warnings = m.warnings ?? 0;
  // The API sends Go's zero time for unset timestamps; treat those as missing.
  const startedAt = realDate(m.started_at);
  const completedAt = realDate(m.completed_at);
  const timeRef = startedAt ?? m.created_at;
  const timeLabel = startedAt ? 'Started' : 'Created';
  // Only measure a duration that has a real end: a live one while running, or the recorded finish.
  const duration = startedAt && (isRunning || completedAt) ? formatDuration(startedAt, isRunning ? undefined : completedAt) : null;
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
        {isCompleted && (
          <div className="mt-1.5">
            <Badge tone={sourceSuspended ? 'neutral' : 'info'} size="sm" dot>
              {sourceSuspended ? 'Source suspended' : 'Source still active'}
            </Badge>
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
          {isCompleted && !sourceSuspended && (
            <Tooltip content="Suspend the account on the source server (after the IP switch)">
              <Button variant="outline" size="sm" leftIcon={<PauseCircleIcon />} onClick={onSuspendSource} className="mr-1">
                Suspend source
              </Button>
            </Tooltip>
          )}
          {isCompleted && sourceSuspended && (
            <Tooltip content="Re-enable the account on the source server">
              <Button variant="ghost" size="sm" leftIcon={<PlayCircleIcon />} onClick={onUnsuspendSource} className="mr-1">
                Unsuspend
              </Button>
            </Tooltip>
          )}
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
