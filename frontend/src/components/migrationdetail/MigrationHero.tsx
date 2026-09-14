import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ClockIcon, ExclamationTriangleIcon, NoSymbolIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { Badge, Card, CodeBlock, Figure, Mono, ProgressBar, Spinner, StatusBadge, type BadgeTone, type FigureTone } from '../ui';
import { cn } from '../../lib/cn';
import { formatBytes, formatDate, formatNumber, formatShortDuration, formatTime, parseSizeToBytes, percent, runWindow } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { matchStepId, type Inventory, type TimelineItem } from '../../lib/migrationSteps';
import type { Migration, MigrationLog } from '../../types';

export interface MigrationHeroProps {
  migration: Migration;
  logs: MigrationLog[];
  /** What moved, parsed from the log (`parseInventory`). */
  inventory: Inventory;
  /** Number of warn-level log lines (the same count the warnings card shows). */
  warningCount: number;
  /** Step timeline (`deriveTimeline`); used to name the step a failed run stopped at. */
  timeline?: TimelineItem[];
  className?: string;
  style?: CSSProperties;
}

const edgeFor: Record<Migration['status'], BadgeTone> = {
  completed: 'success',
  failed: 'danger',
  running: 'brand',
  awaiting_review: 'warning',
  cancelled: 'warning',
  pending: 'neutral',
};

/** Large tinted tile that mirrors the status tone. Completed pops in and draws its check once. */
function StatusTile({ status, runningLabel }: { status: Migration['status']; runningLabel: string }) {
  const base = 'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-none ring-1 ring-inset';
  switch (status) {
    case 'completed':
      return (
        <div
          className={cn(
            base,
            'bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30 motion-safe:animate-ring-pop',
          )}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9.25" className="opacity-40" />
            <path d="M7.5 12.5l3 3 6-6.5" pathLength="100" className="draw-path motion-safe:animate-draw" style={{ animationDelay: '220ms' }} />
          </svg>
        </div>
      );
    case 'running':
      return (
        <div className={cn(base, 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30')}>
          <Spinner size="lg" label={runningLabel} />
        </div>
      );
    case 'awaiting_review':
      return (
        <div className={cn(base, 'bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30')}>
          <ExclamationTriangleIcon className="h-6 w-6" aria-hidden="true" />
        </div>
      );
    case 'failed':
      return (
        <div className={cn(base, 'bg-rose-50 text-rose-600 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:ring-rose-500/30')}>
          <XCircleIcon className="h-6 w-6" aria-hidden="true" />
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
        <div className={cn(base, 'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-white/[0.06] dark:text-slate-400 dark:ring-white/[0.1]')}>
          <ClockIcon className="h-6 w-6" aria-hidden="true" />
        </div>
      );
  }
}

/** Outcome panel under the figures: rose for a failed run (error in a mono, LTR pre), amber for a cancelled one. */
function OutcomePanel({ migration }: { migration: Migration }) {
  const t = useT();
  if (migration.status === 'failed') {
    return (
      <div
        role="alert"
        className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
      >
        <XCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose-500 dark:text-rose-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('migrationdetail.outcome.error')}</p>
          {migration.error ? (
            <pre dir="ltr" className="ltr mt-1.5 whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-rose-700 dark:text-rose-200">
              {migration.error}
            </pre>
          ) : (
            <p className="mt-1 text-sm text-rose-600 dark:text-rose-300/80">{t('migrationdetail.outcome.noError')}</p>
          )}
        </div>
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
        <p className="min-w-0 flex-1 text-sm">{t('migrationdetail.outcome.cancelled')}</p>
      </div>
    );
  }
  return null;
}

function toMs(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = new Date(v).getTime();
  return Number.isNaN(n) ? undefined : n;
}

function sameDay(a: string | undefined, b: string | undefined): boolean {
  const ma = toMs(a);
  const mb = toMs(b);
  return ma !== undefined && mb !== undefined && new Date(ma).toDateString() === new Date(mb).toDateString();
}

/** The mono stack has no Hebrew glyphs: a translated unit ("44 שנ׳") reads better in the UI face. */
const HEBREW_LETTERS = /[\u0590-\u05FF]/;

/**
 * Hero card of the migration detail page: status tile + chip, a state-aware headline
 * ("chayei-olam.co.il is live on panel01"), inventory chips, the id, four big figures
 * (duration / files / transferred / warnings) parsed from the log, the run timestamps,
 * the live progress bar while running and the outcome panel for failed / cancelled runs.
 */
export function MigrationHero({ migration, logs, inventory, warningCount, timeline, className, style }: MigrationHeroProps) {
  const t = useT();
  const running = migration.status === 'running';
  const live = running || migration.status === 'awaiting_review';
  const progress = percent(migration.completed_steps, migration.total_steps);
  const node = migration.target_node || migration.target_ip;

  // Duration ticks every second while the run is live.
  const win = runWindow(migration, logs);
  const startMs = toMs(win.startedAt);
  const ticking = live && startMs !== undefined && !win.endedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  const endMs = win.endedAt ? toMs(win.endedAt) : ticking ? now : undefined;
  const durationMs = startMs !== undefined && endMs !== undefined && endMs >= startMs ? endMs - startMs : undefined;

  // Headline: one sentence that says where things stand.
  const currentStepId = migration.current_step ? matchStepId(migration.current_step) : null;
  const currentStepLabel: ReactNode = currentStepId
    ? t(`steps.${currentStepId}.name`)
    : migration.current_step
      ? <bdi>{migration.current_step}</bdi>
      : t('migrationdetail.hero.processing');
  let headline: ReactNode;
  switch (migration.status) {
    case 'completed': {
      const domain = migration.export_data?.domains?.[0]?.name || migration.export_data?.account?.domain || migration.account_username;
      headline = t.rich('migrationdetail.hero.completed', { domain: <Mono>{domain}</Mono>, node: node ? <Mono>{node}</Mono> : t('common.unknown') });
      break;
    }
    case 'running':
      headline = node ? t.rich('migrationdetail.hero.running', { step: currentStepLabel, node: <Mono>{node}</Mono> }) : currentStepLabel;
      break;
    case 'awaiting_review':
      headline = t('migrationdetail.hero.awaitingReview');
      break;
    case 'failed': {
      const failedStep = timeline?.find((item) => item.status === 'error');
      headline = failedStep ? t('migrationdetail.hero.failed', { step: t(`steps.${failedStep.id}.name`) }) : t('migrationdetail.hero.failedNoStep');
      break;
    }
    case 'cancelled':
      headline = t('migrationdetail.hero.cancelled');
      break;
    default:
      headline = t('migrationdetail.hero.pending');
  }

  // Inventory chips: only what actually moved (zeros are omitted).
  const account = migration.export_data?.account;
  const chips: { key: string; label: string; mono?: boolean }[] = [];
  if (inventory.databases > 0) {
    chips.push({
      key: 'db',
      label: inventory.tables > 0
        ? `${t('units.databases', { count: inventory.databases })} · ${t('units.tables', { count: inventory.tables })}`
        : t('units.databases', { count: inventory.databases }),
    });
  }
  if (inventory.mailboxes > 0) chips.push({ key: 'mail', label: t('units.mailboxes', { count: inventory.mailboxes }) });
  if (inventory.cronJobs > 0) chips.push({ key: 'cron', label: t('units.cronJobs', { count: inventory.cronJobs }) });
  if (inventory.ssl > 0) chips.push({ key: 'ssl', label: t('migrationdetail.chips.ssl', { count: inventory.ssl }) });
  if (account?.php_version) chips.push({ key: 'php', label: `PHP ${account.php_version}`, mono: true });
  if (account?.is_wordpress) chips.push({ key: 'wp', label: t('migrationdetail.chips.wordpress') });

  const transferred = inventory.bytesLabel ? formatBytes(parseSizeToBytes(inventory.bytesLabel)) : undefined;
  const durationLabel = formatShortDuration(durationMs);
  // Sizes are Latin ("296 MB"): isolate them so an RTL block does not reorder number and unit.
  const figures: { key: string; label: string; value: ReactNode; mono?: boolean; live?: boolean; tone?: FigureTone }[] = [
    { key: 'duration', label: t('migrationdetail.figures.duration'), value: durationLabel, mono: !HEBREW_LETTERS.test(durationLabel), live: ticking && durationMs !== undefined },
    { key: 'files', label: t('migrationdetail.figures.files'), value: inventory.files !== undefined ? formatNumber(inventory.files) : t('common.notAvailable') },
    { key: 'bytes', label: t('migrationdetail.figures.transferred'), value: transferred ? <bdi dir="ltr">{transferred}</bdi> : t('common.notAvailable'), mono: true },
    { key: 'warnings', label: t('migrationdetail.figures.warnings'), value: formatNumber(warningCount), tone: warningCount > 0 ? 'warning' : 'neutral' },
  ];

  // "Created" carries the date; a start / finish on that same day shows the time alone, with seconds
  // (runs are short and the two stamps are usually a minute apart).
  const numericDate = (value: string | undefined) => (
    <Mono className="text-slate-700 dark:text-slate-300">
      {sameDay(value, migration.created_at) && value !== migration.created_at
        ? formatTime(value)
        : formatDate(value, { year: 'numeric', month: '2-digit', day: '2-digit' })}
    </Mono>
  );

  return (
    <Card edge={edgeFor[migration.status] ?? 'neutral'} className={className} style={style}>
      <div className="flex items-start gap-4">
        <StatusTile status={migration.status} runningLabel={t('migrationdetail.hero.runningLabel')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={migration.status} size="lg" glow={running} />
          </div>
          <h2 className="mt-2 text-balance text-xl font-semibold leading-snug text-slate-900 dark:text-slate-50">{headline}</h2>
          {chips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <Badge key={chip.key} tone="neutral" size="sm" mono={chip.mono} className="tabular">
                  {chip.mono ? <bdi dir="ltr">{chip.label}</bdi> : chip.label}
                </Badge>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{t('migrationdetail.hero.id')}</span>
            <CodeBlock inline code={migration.id} />
          </div>
        </div>
      </div>

      {/* Four figures in a row, except while the timeline aside squeezes the card (lg up to ~1400px):
          there a Hebrew duration ("1 דק׳ 47 שנ׳") no longer fits a quarter, so the strip folds to 2x2. */}
      <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 dark:border-white/[0.06] dark:bg-white/[0.02] sm:grid-cols-4 lg:grid-cols-2 min-[1400px]:grid-cols-4">
        {figures.map((f, i) => (
          <div
            key={f.key}
            className={cn(
              'px-4 py-3',
              i % 2 === 1 && 'border-s border-slate-200 dark:border-white/[0.06]',
              i >= 2 && 'border-t border-slate-200 dark:border-white/[0.06] sm:border-t-0 lg:border-t min-[1400px]:border-t-0',
              i === 2 && 'sm:border-s lg:border-s-0 min-[1400px]:border-s',
            )}
          >
            <Figure label={f.label} value={f.value} mono={f.mono} live={f.live} tone={f.tone} />
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        {win.endedAt
          ? t.rich('migrationdetail.hero.timestamps', {
              created: numericDate(migration.created_at),
              started: numericDate(win.startedAt),
              ended: numericDate(win.endedAt),
            })
          : t.rich('migrationdetail.hero.timestampsOpen', {
              created: numericDate(migration.created_at),
              started: numericDate(win.startedAt),
            })}
      </p>

      {running && (
        <div className="mt-5 space-y-2 border-t border-slate-200 pt-5 dark:border-white/[0.08]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-300">{currentStepLabel}</span>
            <span className="shrink-0 text-xs tabular text-slate-500 dark:text-slate-400">
              {t('migrationdetail.hero.stepsOf', { done: migration.completed_steps, total: migration.total_steps })}
            </span>
          </div>
          <ProgressBar value={progress} showValue live tone="brand" size="md" label={t('a11y.progress')} />
        </div>
      )}

      {(migration.status === 'failed' || migration.status === 'cancelled') && (
        <div className="mt-5">
          <OutcomePanel migration={migration} />
        </div>
      )}
    </Card>
  );
}

export default MigrationHero;
