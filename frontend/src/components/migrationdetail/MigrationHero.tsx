import { useState } from 'react';
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/16/solid';
import { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon, NoSymbolIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { Badge, Card, IconButton, KeyValue, ProgressBar, Spinner, StatusBadge, Tooltip, copyToClipboard } from '../ui';
import { cn } from '../../lib/cn';
import { formatBytes, formatDate, formatDuration, percent } from '../../lib/format';
import type { Migration } from '../../types';

interface MigrationHeroProps {
  migration: Migration;
}

/** Large tinted icon tile that mirrors the StatusBadge tone. */
function StatusTile({ status }: { status: Migration['status'] }) {
  const base = 'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset';
  switch (status) {
    case 'completed':
      return (
        <div className={cn(base, 'bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30')}>
          <CheckCircleIcon className="h-6 w-6" aria-hidden="true" />
        </div>
      );
    case 'failed':
      return (
        <div className={cn(base, 'bg-rose-50 text-rose-600 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:ring-rose-500/30')}>
          <XCircleIcon className="h-6 w-6" aria-hidden="true" />
        </div>
      );
    case 'running':
      return (
        <div className={cn(base, 'bg-indigo-50 text-indigo-600 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-400 dark:ring-indigo-500/30')}>
          <Spinner size="lg" label="Migration running" />
        </div>
      );
    case 'cancelled':
      return (
        <div className={cn(base, 'bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30')}>
          <NoSymbolIcon className="h-6 w-6" aria-hidden="true" />
        </div>
      );
    default:
      return (
        <div className={cn(base, 'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700')}>
          <ClockIcon className="h-6 w-6" aria-hidden="true" />
        </div>
      );
  }
}

/** The API serialises an unset `started_at` as Go's zero time (0001-01-01); treat anything before 2000 as unset. */
function realDate(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 ? undefined : input;
}

function headline(m: Migration): string {
  switch (m.status) {
    case 'running':
      return m.current_step || 'Processing…';
    case 'completed':
      return m.warnings ? `Completed with ${m.warnings} warning${m.warnings === 1 ? '' : 's'}` : 'Completed successfully';
    case 'failed':
      return 'Migration failed';
    case 'cancelled':
      return 'Migration cancelled';
    default:
      return 'Waiting to start';
  }
}

/** Outcome panel shown under the summary (rose = failed, emerald/amber = completed). */
function OutcomePanel({ migration }: { migration: Migration }) {
  if (migration.status === 'failed') {
    return (
      <div
        role="alert"
        className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
      >
        <XCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose-500 dark:text-rose-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Error</p>
          {migration.error ? (
            <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-rose-700 dark:text-rose-200">{migration.error}</pre>
          ) : (
            <p className="mt-1 text-sm text-rose-600 dark:text-rose-300/80">No error message was recorded. Check the log below for details.</p>
          )}
        </div>
      </div>
    );
  }

  if (migration.status === 'completed') {
    const withWarnings = !!migration.warnings;
    return (
      <div
        role="status"
        className={cn(
          'flex gap-3 rounded-lg border p-4',
          withWarnings
            ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
        )}
      >
        {withWarnings ? (
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true" />
        ) : (
          <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
        )}
        <p className="min-w-0 flex-1 text-sm">
          {withWarnings ? 'Review the warnings below before switching DNS.' : 'The account has been migrated to the target server.'}
        </p>
      </div>
    );
  }

  if (migration.status === 'cancelled') {
    return (
      <div
        role="status"
        className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
      >
        <NoSymbolIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm">The run was stopped before it finished. The target may hold a partial copy.</p>
      </div>
    );
  }

  return null;
}

/**
 * Hero card for the migration detail page: status tile + large badge, id with copy,
 * timing/warnings/node metadata, progress while running and the outcome panel.
 */
export function MigrationHero({ migration }: MigrationHeroProps) {
  const [copied, setCopied] = useState(false);
  const isRunning = migration.status === 'running';
  const progress = percent(migration.completed_steps, migration.total_steps);

  const copyId = async () => {
    const ok = await copyToClipboard(migration.id, 'Migration id copied');
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const startedAt = realDate(migration.started_at);
  const completedAt = realDate(migration.completed_at);
  const duration = startedAt ? formatDuration(startedAt, completedAt) : '—';
  const bytesTransferred = migration.progress?.bytes_transferred ?? migration.bytes_transferred ?? 0;
  const totalBytes = migration.progress?.total_bytes ?? migration.total_bytes ?? 0;

  return (
    <Card>
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <StatusTile status={migration.status} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={migration.status} className="h-7 px-2.5 text-sm" />
              <h2 className="truncate text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">{headline(migration)}</h2>
            </div>
            <div className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="shrink-0">Migration id</span>
              <code className="min-w-0 truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                {migration.id}
              </code>
              <Tooltip content={copied ? 'Copied' : 'Copy id'}>
                <IconButton
                  aria-label="Copy migration id"
                  size="xs"
                  icon={copied ? <CheckIcon className="text-emerald-500" /> : <ClipboardDocumentIcon />}
                  onClick={copyId}
                />
              </Tooltip>
            </div>
          </div>
        </div>

        <KeyValue
          layout="grid"
          columns={3}
          className="xl:min-w-[32rem] xl:max-w-2xl xl:shrink-0"
          items={[
            { label: 'Duration', value: <span className="tabular">{duration}</span> },
            { label: 'Started', value: formatDate(startedAt) },
            { label: 'Completed', value: formatDate(completedAt) },
            {
              label: 'Warnings',
              value: migration.warnings ? (
                <Badge tone="warning" size="sm" icon={<ExclamationTriangleIcon />}>
                  {migration.warnings} warning{migration.warnings === 1 ? '' : 's'}
                </Badge>
              ) : (
                <Badge tone="neutral" size="sm">None</Badge>
              ),
            },
            { label: 'Created', value: formatDate(migration.created_at) },
            { label: 'Steps', value: <span className="tabular">{migration.completed_steps} / {migration.total_steps}</span> },
          ]}
        />
      </div>

      {isRunning && (
        <div className="mt-6 space-y-2 border-t border-slate-200 pt-5 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-300">{migration.current_step || 'Processing…'}</span>
            <span className="shrink-0 text-xs tabular text-slate-500 dark:text-slate-400">
              {migration.completed_steps}/{migration.total_steps} steps
            </span>
          </div>
          <ProgressBar value={progress} showValue tone="brand" size="md" label="Migration progress" />
          {bytesTransferred > 0 && (
            <p className="text-xs tabular text-slate-500 dark:text-slate-400">
              Transferred <span className="font-mono text-slate-700 dark:text-slate-300">{formatBytes(bytesTransferred)}</span>
              {totalBytes > 0 && (
                <>
                  {' '}of <span className="font-mono text-slate-700 dark:text-slate-300">{formatBytes(totalBytes)}</span>
                </>
              )}
            </p>
          )}
        </div>
      )}

      {!isRunning && migration.status !== 'pending' && (
        <div className="mt-6">
          <OutcomePanel migration={migration} />
        </div>
      )}
    </Card>
  );
}

export default MigrationHero;
