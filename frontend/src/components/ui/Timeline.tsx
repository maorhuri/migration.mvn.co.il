import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { CheckIcon, ExclamationTriangleIcon, NoSymbolIcon, XMarkIcon } from '@heroicons/react/16/solid';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { formatShortDuration } from '../../lib/format';
import type { TimelineItem } from '../../lib/migrationSteps';
import { Spinner } from './Spinner';

export type { TimelineItem } from '../../lib/migrationSteps';

export interface TimelineProps {
  items: TimelineItem[];
  /** The run is still going: the running step's duration ticks every second. */
  live?: boolean;
  /** Makes rows clickable: called with the step's first log id. */
  onJump?: (logId: string) => void;
  /** Phase labels ('export' -> "Export from X"); pass a node to keep the hostname in `<Mono>`. Falls back to t('steps.phase.<phase>'). */
  phaseLabels?: Record<string, ReactNode>;
  className?: string;
}

/** The mono stack has no Hebrew glyphs of its own: a translated unit ("2.0 שנ׳") reads better in the UI face. */
const HEBREW = /[\u0590-\u05FF]/;

function toMs(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = typeof v === 'number' ? v : new Date(v).getTime();
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Run timeline derived from the log (see `deriveTimeline`): one row per step with a state ring,
 * per-step duration, line/warning counts and the live step's details. Not a Card; pages wrap it.
 */
export function Timeline({ items, live, onJump, phaseLabels, className }: TimelineProps) {
  const t = useT();
  const hasRunning = items.some((i) => i.status === 'running');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live || !hasRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live, hasRunning]);

  let lastPhase: string | null = null;

  return (
    <ol aria-label={t('stepper.progress')} className={cn('px-6 py-4', className)}>
      {items.map((item, idx) => {
        const phaseLabel = item.phase !== lastPhase ? phaseLabels?.[item.phase] ?? t(`steps.phase.${item.phase}`, { name: '' }).trim() : null;
        lastPhase = item.phase;
        const last = idx === items.length - 1;
        const running = item.status === 'running';
        const startMs = toMs(item.startedAt);
        const durationMs = running && live && startMs !== undefined ? Math.max(0, now - startMs) : item.durationMs;
        const name = item.name ?? t(`steps.${item.id}.name`);
        const details = running ? item.details ?? t(`steps.${item.id}.details`) : null;
        const durationLabel = item.status === 'skipped' ? t('time.noWork') : durationMs !== undefined ? formatShortDuration(durationMs) : '';
        const errorIsHebrew = !!item.error && HEBREW.test(item.error);

        const ring = (
          <span
            aria-hidden="true"
            className={cn(
              'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              item.status === 'completed' && 'bg-emerald-500 text-white',
              running && 'border border-brand-500 bg-white text-brand-700 dark:bg-slate-900 dark:text-brand-300 motion-safe:animate-pulse-ring',
              item.status === 'error' && 'bg-rose-500 text-white',
              item.status === 'cancelled' && 'bg-amber-500 text-white',
              item.status === 'warning' && 'bg-amber-500 text-white',
              (item.status === 'pending' || item.status === 'skipped') && 'ring-1 ring-inset ring-slate-300 text-slate-400 dark:ring-white/[0.15] dark:text-slate-500',
            )}
          >
            {item.status === 'completed' ? (
              <CheckIcon className="h-4 w-4" />
            ) : running ? (
              <Spinner size="sm" />
            ) : item.status === 'error' ? (
              <XMarkIcon className="h-4 w-4" />
            ) : item.status === 'cancelled' ? (
              <NoSymbolIcon className="h-4 w-4" />
            ) : item.status === 'warning' ? (
              <ExclamationTriangleIcon className="h-3.5 w-3.5" />
            ) : (
              idx + 1
            )}
          </span>
        );

        const body = (
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={cn(
                  'truncate text-sm font-medium',
                  item.status === 'pending' || item.status === 'skipped'
                    ? 'text-slate-500 dark:text-slate-400'
                    : item.status === 'error'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-900 dark:text-slate-100',
                )}
              >
                {name}
              </span>
              <span
                className={cn(
                  'shrink-0 text-xs tabular',
                  HEBREW.test(durationLabel) ? 'font-sans' : 'font-mono',
                  running ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400',
                  item.status === 'skipped' && 'text-slate-400 dark:text-slate-500',
                )}
              >
                {durationLabel}
              </span>
            </div>
            {(item.lineCount > 0 || item.warnCount > 0) && (
              <p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">
                {t('units.lines', { count: item.lineCount })}
                {item.warnCount > 0 && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="text-amber-600 dark:text-amber-400">{t('units.warnings', { count: item.warnCount })}</span>
                  </>
                )}
              </p>
            )}
            {details && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="truncate">{details}</span>
                <span className="inline-flex shrink-0 items-center gap-0.5" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1 w-1 rounded-full bg-brand-500 motion-safe:animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />
                  ))}
                </span>
              </p>
            )}
            {item.error && (
              // Backend errors are raw English: LTR mono, clamped so a long rsync transcript does not swallow the aside.
              <p
                dir="auto"
                title={item.error}
                className={cn('mt-1 line-clamp-4 break-words text-start text-rose-600 dark:text-rose-400', errorIsHebrew ? 'text-xs' : 'font-mono text-2xs leading-4')}
              >
                {item.error}
              </p>
            )}
          </div>
        );

        return (
          <Fragment key={item.id}>
            {phaseLabel && <li className="eyebrow mb-2 mt-4 list-none normal-case first:mt-0">{phaseLabel}</li>}
            <li className={cn('relative flex gap-3', !last && 'pb-5')}>
              {!last && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute start-[13px] top-7 h-[calc(100%-1.75rem)] w-px',
                    item.status === 'completed'
                      ? 'bg-emerald-500'
                      : running
                        ? 'bg-gradient-to-b from-brand-500 to-slate-200 dark:to-slate-700'
                        : 'bg-slate-200 dark:bg-white/[0.08]',
                  )}
                />
              )}
              {item.firstLogId && onJump ? (
                <button
                  type="button"
                  onClick={() => onJump(item.firstLogId!)}
                  title={t('timeline.jumpToLog')}
                  className="-mx-1 flex w-full gap-3 rounded-lg px-1 text-start transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-white/[0.03] dark:focus-visible:ring-brand-300"
                >
                  {ring}
                  {body}
                </button>
              ) : (
                <>
                  {ring}
                  {body}
                </>
              )}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

export default Timeline;
