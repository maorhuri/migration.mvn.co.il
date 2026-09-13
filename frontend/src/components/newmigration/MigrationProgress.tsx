import { ArrowLeftIcon, CheckIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/16/solid';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, LogViewer, ProgressBar, Spinner, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import type { Account, MigrationLog } from '@/types';
import type { MigrationStepStatus } from './types';

interface StepRowProps {
  step: MigrationStepStatus;
  index: number;
}

function StepIcon({ status, index }: { status: MigrationStepStatus['status']; index: number }) {
  const base = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors';
  switch (status) {
    case 'running':
      return (
        <span className={cn(base, 'border border-indigo-500 bg-indigo-50 text-indigo-600 ring-4 ring-indigo-500/15 dark:border-indigo-400 dark:bg-indigo-500/15 dark:text-indigo-300')} aria-hidden="true">
          <Spinner size="sm" />
        </span>
      );
    case 'completed':
      return (
        <span className={cn(base, 'bg-emerald-500 text-white')} aria-hidden="true">
          <CheckIcon className="h-4 w-4" />
        </span>
      );
    case 'error':
      return (
        <span className={cn(base, 'bg-rose-500 text-white')} aria-hidden="true">
          <XMarkIcon className="h-4 w-4" />
        </span>
      );
    case 'warning':
      return (
        <span className={cn(base, 'bg-amber-500 text-white')} aria-hidden="true">
          <ExclamationTriangleIcon className="h-4 w-4" />
        </span>
      );
    default:
      return (
        <span className={cn(base, 'border border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-500')} aria-hidden="true">
          {index + 1}
        </span>
      );
  }
}

function StepRow({ step, index }: StepRowProps) {
  const running = step.status === 'running';
  return (
    <li
      className={cn('flex items-start gap-3 px-5 py-3 transition-colors sm:px-6', running && 'bg-indigo-50/60 dark:bg-indigo-500/10')}
      aria-current={running ? 'step' : undefined}
    >
      <StepIcon status={step.status} index={index} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p
            className={cn(
              'text-sm font-medium leading-tight',
              step.status === 'pending' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-slate-100',
              step.status === 'error' && 'text-rose-700 dark:text-rose-300',
            )}
          >
            {step.name}
          </p>
          {step.duration !== undefined && <span className="shrink-0 font-mono text-xs tabular text-slate-400 dark:text-slate-500">{step.duration}s</span>}
        </div>
        {running && step.details && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{step.details}</p>}
        {step.status === 'error' && step.error && (
          <p className="mt-1 break-words text-xs text-rose-600 dark:text-rose-400">
            <span className="font-medium">Error:</span> {step.error}
          </p>
        )}
        {step.status === 'warning' && step.error && (
          <p className="mt-1 break-words text-xs text-amber-700 dark:text-amber-300">
            <span className="font-medium">Warning:</span> {step.error}
          </p>
        )}
      </div>
    </li>
  );
}

export interface MigrationProgressProps {
  steps: MigrationStepStatus[];
  currentStepIndex: number;
  overallProgress: number;
  elapsedMs: number;
  /** True while handleStartMigration is running. */
  running: boolean;
  /** True once the run has stopped with a step in error. */
  failed: boolean;
  logs: MigrationLog[];
  accounts: Account[];
  /** Username of the account currently being migrated (multi-account runs go one at a time). */
  activeAccount?: string | null;
  targetNode: string;
  onBackToReview: () => void;
  onViewMigrations: () => void;
}

/**
 * Live view of a running migration: header with elapsed time + progress,
 * the step list on the left and the polled log console on the right.
 */
export function MigrationProgress({
  steps,
  currentStepIndex,
  overallProgress,
  elapsedMs,
  running,
  failed,
  logs,
  accounts,
  activeAccount,
  targetNode,
  onBackToReview,
  onViewMigrations,
}: MigrationProgressProps) {
  const status = running ? 'running' : failed ? 'failed' : 'completed';
  const tone = failed ? 'danger' : running ? 'brand' : 'success';
  const title = running ? 'Migration in progress' : failed ? 'Migration failed' : 'Migration finished';
  const description = running
    ? 'Keep this page open. Steps update as the backend reports progress; the console shows the live log.'
    : failed
      ? 'The run stopped on the step marked below. Check the console for details, then go back to review and retry.'
      : 'All steps finished.';
  const stepLabel = steps.length > 0 ? `${Math.min(currentStepIndex + 1, steps.length)} / ${steps.length}` : '—';
  const activeIndex = activeAccount ? accounts.findIndex((a) => a.username === activeAccount) : -1;
  const accountLabel = accounts.length > 1 ? `${activeIndex >= 0 ? activeIndex + 1 : 1} / ${accounts.length}` : null;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle>{title}</CardTitle>
              <StatusBadge status={status} />
            </div>
            <CardDescription>{description}</CardDescription>
          </div>
          <dl className="flex shrink-0 items-center gap-6">
            {accountLabel && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Account</dt>
                <dd className="mt-0.5 font-mono text-lg font-semibold tabular text-slate-900 dark:text-slate-100">{accountLabel}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Elapsed</dt>
              <dd className="mt-0.5 font-mono text-lg font-semibold tabular text-slate-900 dark:text-slate-100">{formatDuration(elapsedMs)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Step</dt>
              <dd className="mt-0.5 font-mono text-lg font-semibold tabular text-slate-900 dark:text-slate-100">{stepLabel}</dd>
            </div>
          </dl>
        </div>

        <ProgressBar className="mt-5" value={overallProgress} tone={tone} size="md" showValue label="Overall migration progress" />

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">Migrating</span>
          {accounts.map((account, i) => {
            const isActive = activeIndex >= 0 && i === activeIndex;
            const isDone = activeIndex >= 0 && i < activeIndex;
            return (
              <Badge
                key={account.username}
                tone={isActive ? (failed ? 'danger' : 'brand') : isDone ? 'success' : 'neutral'}
                size="sm"
                mono
                dot={isActive || isDone}
                pulse={isActive && running}
              >
                {account.domain || account.username}
              </Badge>
            );
          })}
          {targetNode && (
            <>
              <span className="mx-1 text-xs text-slate-400 dark:text-slate-500">to</span>
              <Badge tone="violet" size="sm" mono>
                {targetNode}
              </Badge>
            </>
          )}
        </div>

        {!running && (
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Button variant="secondary" leftIcon={<ArrowLeftIcon />} onClick={onBackToReview}>
              Back to review
            </Button>
            <Button variant={failed ? 'primary' : 'secondary'} onClick={onViewMigrations}>
              View all migrations
            </Button>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card flush className="lg:col-span-2">
          <CardHeader divided>
            <CardTitle>Steps</CardTitle>
            <CardDescription>Export from the source, then import into the target.</CardDescription>
          </CardHeader>
          <ol className="divide-y divide-slate-100 dark:divide-slate-800" aria-label="Migration steps">
            {steps.map((step, index) => (
              <StepRow key={step.id} step={step} index={index} />
            ))}
          </ol>
        </Card>

        <div className="lg:col-span-3">
          <LogViewer items={logs} live={running} height="34rem" title="Live console" emptyMessage={running ? 'Waiting for the first log line…' : 'No log lines were recorded'} />
        </div>
      </div>
    </div>
  );
}

export default MigrationProgress;
