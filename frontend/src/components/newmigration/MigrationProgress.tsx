import { useMemo } from 'react';
import { ArrowLeftIcon } from '@heroicons/react/16/solid';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, Figure, LogViewer, Mono, ProgressBar, StatusBadge, Timeline, type TimelineItem } from '../ui';
import { useT } from '../../lib/i18n';
import { formatDuration, formatNumber } from '../../lib/format';
import { matchStepId, parseInventory } from '../../lib/migrationSteps';
import type { Account, MigrationLog } from '../../types';
import type { MigrationStepStatus } from './types';

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
  /** Names for the timeline phase labels ("Export from X" / "Import to Y"). */
  sourceName?: string;
  targetName?: string;
  onBackToReview: () => void;
  onViewMigrations: () => void;
}

const phaseOf = (id: string): TimelineItem['phase'] => (id.startsWith('export_') ? 'export' : id === 'scan_malware' ? 'scan' : 'import');

/**
 * Launch console for a running migration: a mission strip (status, elapsed, step, live bar),
 * the run timeline with per-step durations, the inventory counters and the live console.
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
  sourceName,
  targetName,
  onBackToReview,
  onViewMigrations,
}: MigrationProgressProps) {
  const t = useT();
  const status = running ? 'running' : failed ? 'failed' : 'completed';
  const tone = failed ? 'danger' : running ? 'brand' : 'success';
  const title = running ? t('newmigration.progress.running') : failed ? t('newmigration.progress.failed') : t('newmigration.progress.finished');
  const description = running ? t('newmigration.progress.runningHint') : failed ? t('newmigration.progress.failedHint') : t('newmigration.progress.finishedHint');
  const stepLabel = steps.length > 0 ? `${Math.min(currentStepIndex + 1, steps.length)} / ${steps.length}` : '—';
  const activeIndex = activeAccount ? accounts.findIndex((a) => a.username === activeAccount) : -1;
  const accountLabel = accounts.length > 1 ? `${activeIndex >= 0 ? activeIndex + 1 : 1} / ${accounts.length}` : null;
  const doneCount = steps.filter((s) => s.status === 'completed').length;

  // When the running step (or the account) changes, that is the moment the step started ticking.
  const runningSince = useMemo(() => Date.now(), [currentStepIndex, activeAccount]);

  const items = useMemo<TimelineItem[]>(
    () =>
      steps.map((s) => ({
        id: s.id,
        phase: phaseOf(s.id),
        status: s.status,
        durationMs: s.duration !== undefined ? s.duration * 1000 : undefined,
        startedAt: s.status === 'running' ? runningSince : undefined,
        lineCount: 0,
        warnCount: 0,
        error: s.error,
      })),
    [steps, runningSince],
  );

  const inventory = useMemo(() => parseInventory(logs), [logs]);

  // Section headers: the first log line of every step boundary (walking the log in order).
  const sectionIds = useMemo(() => {
    const map = new Map<string, string>();
    let current: string | null = null;
    for (const log of logs) {
      const id = matchStepId(log.message);
      if (id && id !== current) {
        current = id;
        map.set(log.id, id);
      }
    }
    return map;
  }, [logs]);

  const counter = (n: number | undefined) => (n === undefined || (running && n === 0) ? '—' : n);
  // Phase labels keep the server / node name LTR mono inside the translated phrase.
  const importName = targetName || targetNode.replace(/\s*\([^)]*\)\s*$/, '');

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-lg">{title}</CardTitle>
              <StatusBadge status={status} size="lg" glow={running} />
            </div>
            <CardDescription>{description}</CardDescription>
          </div>
          <dl className="flex shrink-0 flex-wrap gap-8">
            {accountLabel && <Figure label={t('newmigration.progress.account')} value={<span dir="ltr">{accountLabel}</span>} mono />}
            <Figure size="lg" live={running} label={t('time.elapsed')} value={formatDuration(elapsedMs)} />
            <Figure mono label={t('newmigration.progress.step')} value={<span dir="ltr">{stepLabel}</span>} />
          </dl>
        </div>

        <ProgressBar className="mt-5" value={overallProgress} tone={tone} size="md" live={running} showValue label={t('newmigration.progress.overall')} />

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="me-1 text-xs text-slate-500 dark:text-slate-400">{t('newmigration.progress.migrating')}</span>
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
              <span className="mx-1 text-xs text-slate-400 dark:text-slate-500">{t('common.to')}</span>
              <Badge tone="violet" size="sm" mono>
                {targetNode}
              </Badge>
            </>
          )}
        </div>

        {!running && (
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4 dark:border-white/[0.08]">
            <Button variant="secondary" leftIcon={<ArrowLeftIcon className="flip-rtl" />} onClick={onBackToReview}>
              {t('newmigration.progress.backToReview')}
            </Button>
            <Button variant={failed ? 'primary' : 'secondary'} onClick={onViewMigrations}>
              {t('newmigration.progress.viewAll')}
            </Button>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card flush className="self-start">
          <CardHeader divided actions={<span dir="ltr" className="font-mono text-xs tabular text-slate-500 dark:text-slate-400">{`${doneCount} / ${steps.length}`}</span>}>
            <CardTitle>{t('newmigration.progress.timeline')}</CardTitle>
          </CardHeader>
          <Timeline
            items={items}
            live={running}
            phaseLabels={{
              export: t.rich('steps.phase.export', { name: sourceName ? <Mono>{sourceName}</Mono> : t('newmigration.review.sourceFallback') }),
              scan: t('steps.phase.scan'),
              import: t.rich('steps.phase.import', { name: importName ? <Mono>{importName}</Mono> : t('newmigration.review.targetFallback') }),
            }}
          />
        </Card>

        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <Figure size="sm" mono label={t('newmigration.progress.inv.files')} value={inventory.files !== undefined ? formatNumber(inventory.files) : '—'} />
            </Card>
            <Card className="p-4">
              <Figure size="sm" mono label={t('newmigration.progress.inv.transferred')} value={inventory.bytesLabel ?? '—'} />
            </Card>
            <Card className="p-4">
              <Figure size="sm" mono countUp label={t('newmigration.progress.inv.databases')} value={counter(inventory.databases)} />
            </Card>
            <Card className="p-4">
              <Figure size="sm" mono countUp label={t('newmigration.progress.inv.mailboxes')} value={counter(inventory.mailboxes)} />
            </Card>
          </div>
          <LogViewer
            items={logs}
            live={running}
            cursor={running}
            height="30rem"
            title={t('newmigration.progress.console')}
            sectionFor={(it) => {
              const id = sectionIds.get(it.id);
              return id ? t(`steps.${id}.name`) : null;
            }}
            emptyMessage={running ? t('log.waitingFirstLine') : t('newmigration.progress.noLog')}
          />
        </div>
      </div>
    </div>
  );
}

export default MigrationProgress;
