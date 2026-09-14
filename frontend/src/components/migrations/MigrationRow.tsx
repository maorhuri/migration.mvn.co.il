import { Link } from 'react-router-dom';
import { ArrowRightIcon, ExclamationTriangleIcon } from '@heroicons/react/16/solid';
import { PauseCircleIcon, PlayCircleIcon, StopIcon, TrashIcon } from '@heroicons/react/20/solid';
import { Badge, Button, IconButton, Mono, PanelMonogram, ProgressBar, StatusBadge, TD, TDPrimary, TR, Tooltip } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { matchStepId } from '../../lib/migrationSteps';
import { formatDate, formatDuration, formatRelativeTime, percent, realDate, runWindow, shortId } from '../../lib/format';
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

/** Numeric timestamp for the mono line: "14.09.2026, 00:04" (he-IL) / "09/14/2026, 00:04" (en-US). Digits only, so it is safe LTR. */
const NUMERIC_DATE: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit' };

/** One migration in the list table: account, route, node (xl+), status/progress, warnings, timing, actions. Click the row to open it. */
export function MigrationRow({ migration, source, target, onView, onCancel, onDelete, onSuspendSource, onUnsuspendSource }: MigrationRowProps) {
  const t = useT();
  const m = migration;
  const isRunning = m.status === 'running';
  const canCancel = m.status === 'running' || m.status === 'pending' || m.status === 'awaiting_review';
  const canDelete = m.status !== 'running';
  const isCompleted = m.status === 'completed';
  const sourceSuspended = !!m.source_suspended_at;
  const warnings = m.warnings ?? 0;
  // The API sends Go's zero time for unset timestamps; treat those as missing.
  const startedAt = realDate(m.started_at);
  const timeRef = startedAt ?? m.created_at;
  const timeLabel = startedAt ? t('time.started') : t('time.created');
  // runWindow falls back to created_at for the Go-zero started_at, so finished rows still get a real duration.
  const win = runWindow(m, []);
  // Only measure a duration that has a real end: a live one while running, or the recorded finish.
  const duration = win.startedAt && (isRunning || win.endedAt) ? formatDuration(win.startedAt, isRunning ? undefined : win.endedAt) : null;
  // The backend names the current step in English; show the translated step name when it maps to a known step.
  const stepId = m.current_step ? matchStepId(m.current_step) : null;
  const currentStep = stepId ? t(`steps.${stepId}.name`) : m.current_step || t('migrations.row.working');
  // The row itself is a keyboard-activatable button; keep inner controls from bubbling their keys to it.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const nameClass = (known: boolean) => cn('truncate max-w-[10rem]', known ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500');

  return (
    <TR clickable onClick={onView} className={cn('group', isRunning && 'bg-brand-50/40 dark:bg-brand-500/[0.06]')}>
      <TDPrimary>
        <Link
          to={`/migrations/${m.id}`}
          onClick={stop}
          onKeyDown={stop}
          aria-label={t('migrations.row.open', { name: m.account_username })}
          className="rounded-sm text-slate-900 transition-colors hover:text-brand-700 dark:text-slate-100 dark:hover:text-brand-300"
        >
          <Mono className="text-[13px] font-medium">{m.account_username}</Mono>
        </Link>
        <div className="mt-0.5">
          <Mono className="text-2xs text-slate-400 dark:text-slate-500">{shortId(m.id)}</Mono>
        </div>
      </TDPrimary>

      <TD>
        {/* Two nowrap groups in a wrapping row: one line when the table has room, the arrow leads the second line when it folds. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <PanelMonogram panelType={source?.panel_type} size="sm" />
            <span className={nameClass(!!source)} title={source?.name}>
              {source?.name ?? t('common.unknown')}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <ArrowRightIcon className="flip-rtl h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            <PanelMonogram panelType={target?.panel_type} size="sm" />
            <span className={nameClass(!!target)} title={target?.name}>
              {target?.name ?? t('common.unknown')}
            </span>
          </span>
        </div>
      </TD>

      <TD className="hidden 2xl:table-cell">
        {m.target_node || m.target_ip ? (
          <div className="whitespace-nowrap leading-tight">
            {m.target_node && (
              <div>
                <Mono className="text-xs text-slate-700 dark:text-slate-300">{m.target_node}</Mono>
              </div>
            )}
            {m.target_ip && (
              <div>
                <Mono className="text-xs text-slate-500 dark:text-slate-400">{m.target_ip}</Mono>
              </div>
            )}
          </div>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">{t('common.notAvailable')}</span>
        )}
      </TD>

      <TD className="min-w-[150px]">
        <StatusBadge status={m.status} size="sm" />
        {isRunning && (
          <div className="mt-1.5 max-w-[220px]">
            <ProgressBar
              size="xs"
              live
              value={percent(m.completed_steps, m.total_steps)}
              label={t('migrations.row.progress', { done: m.completed_steps, total: m.total_steps })}
            />
            <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-slate-500 dark:text-slate-400">
              <span className="truncate" title={m.current_step}>
                {currentStep}
              </span>
              <bdi dir="ltr" className="tabular shrink-0 font-medium text-brand-700 dark:text-brand-300">
                {m.completed_steps}/{m.total_steps}
              </bdi>
            </div>
          </div>
        )}
        {isCompleted && sourceSuspended && (
          <div className="mt-1.5">
            <Badge tone="neutral" size="sm" dot>
              {t('status.sourceSuspended')}
            </Badge>
          </div>
        )}
        {m.status === 'failed' && m.error && (
          <div className="mt-1 text-2xs text-rose-600 dark:text-rose-400" title={m.error}>
            <bdi dir="ltr" className="inline-block max-w-[220px] truncate align-bottom">
              {m.error}
            </bdi>
          </div>
        )}
      </TD>

      <TD>
        {warnings > 0 ? (
          <Badge tone="warning" size="sm" icon={<ExclamationTriangleIcon />}>
            {warnings}
          </Badge>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">{t('common.notAvailable')}</span>
        )}
      </TD>

      <TD muted className="whitespace-nowrap">
        <div title={formatDate(timeRef)}>
          <span className="text-slate-400 dark:text-slate-500">{timeLabel}</span> {formatRelativeTime(timeRef)}
        </div>
        <div className="mt-0.5 text-2xs text-slate-400 dark:text-slate-500">
          <Mono className="tabular">{formatDate(timeRef, NUMERIC_DATE)}</Mono>
          {duration && (
            <>
              <span aria-hidden="true"> · </span>
              {/* The live duration is the one brand number on the row; the sentence lives in the tooltip so the cell stays narrow. */}
              <span
                className={cn('tabular', isRunning && 'font-medium text-brand-700 dark:text-brand-300')}
                title={isRunning ? t('migrations.row.runningFor', { duration }) : undefined}
              >
                {duration}
              </span>
            </>
          )}
        </div>
      </TD>

      <TD align="end" onClick={stop} onKeyDown={stop} className="whitespace-nowrap">
        <div className="inline-flex items-center gap-1 opacity-70 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {canCancel && (
            <Button variant="outline" size="sm" leftIcon={<StopIcon />} onClick={onCancel}>
              {t('migrations.row.cancel')}
            </Button>
          )}
          {isCompleted && !sourceSuspended && (
            <Tooltip content={t('migrations.row.suspendTip')} align="end">
              <Button variant="outline" size="sm" leftIcon={<PauseCircleIcon />} onClick={onSuspendSource}>
                {t('migrations.row.suspend')}
              </Button>
            </Tooltip>
          )}
          {isCompleted && sourceSuspended && (
            <Tooltip content={t('migrations.row.unsuspendTip')} align="end">
              <Button variant="ghost" size="sm" leftIcon={<PlayCircleIcon />} onClick={onUnsuspendSource}>
                {t('migrations.row.unsuspend')}
              </Button>
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip content={t('common.delete')} align="end">
              <IconButton aria-label={t('migrations.row.delete')} icon={<TrashIcon />} size="sm" tone="danger" onClick={onDelete} />
            </Tooltip>
          )}
        </div>
      </TD>
    </TR>
  );
}

export default MigrationRow;
