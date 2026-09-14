import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon } from '@heroicons/react/16/solid';
import {
  Badge,
  badgeDotClasses,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  Mono,
  ProgressBar,
  Skeleton,
  type BadgeTone,
} from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { percent, realDate } from '../../lib/format';
import type { Migration } from '../../types';

export interface AttentionCardProps {
  migrations: Migration[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  className?: string;
}

type Reason = 'review' | 'running' | 'failed' | 'sourceActive' | 'warnings';

interface AttentionItem {
  migration: Migration;
  reason: Reason;
  warnings: number;
}

/** Lower = more urgent. */
const PRIORITY: Record<Reason, number> = { review: 0, running: 1, failed: 2, sourceActive: 3, warnings: 4 };
const TONE: Record<Reason, BadgeTone> = { review: 'warning', running: 'brand', failed: 'danger', sourceActive: 'warning', warnings: 'neutral' };

const VISIBLE = 5;

/**
 * Derived purely from the migrations list: what still needs the operator.
 * One row per migration, with its most urgent reason; warnings ride along as a chip.
 */
function deriveAttention(migrations: Migration[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const m of migrations) {
    const warnings = m.warnings ?? 0;
    let reason: Reason | null = null;
    if (m.status === 'awaiting_review') reason = 'review';
    else if (m.status === 'running') reason = 'running';
    else if (m.status === 'failed') reason = 'failed';
    else if (m.status === 'completed' && !realDate(m.source_suspended_at)) reason = 'sourceActive';
    else if (warnings > 0) reason = 'warnings';
    if (reason) items.push({ migration: m, reason, warnings });
  }
  // Stable: the API already lists newest first, so equal priorities keep that order.
  return items.sort((a, b) => PRIORITY[a.reason] - PRIORITY[b.reason]);
}

/** The MalCare-style "attention items" card: what needs me, one row per migration. */
export function AttentionCard({ migrations, loading, error, onRetry, className }: AttentionCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const items = useMemo(() => deriveAttention(migrations), [migrations]);
  const visible = expanded ? items : items.slice(0, VISIBLE);
  // Finished-with-warnings rows are worth a look but need no action: they never light the badge.
  const actionable = items.filter((i) => i.reason !== 'warnings').length;
  const headTone: BadgeTone = actionable > 0 ? TONE[items[0].reason] : 'success';

  const reasonText = (item: AttentionItem): ReactNode => {
    switch (item.reason) {
      case 'review':
        return t('dashboard.attention.review');
      case 'running':
        return t('dashboard.attention.running');
      case 'failed':
        // The backend error is raw English: its own LTR mono box next to the label, truncated on its own
        // (a long LTR run inside a truncated Hebrew line collapses to a bare ellipsis in Chrome). `flex-1`
        // sizes it from zero into the remaining space; letting it shrink from max-w-full lands 6px outside in RTL.
        return item.migration.error ? (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0">{t('dashboard.attention.failed')}:</span>
            <Mono className="min-w-0 flex-1 text-xs text-rose-600 dark:text-rose-400">{item.migration.error}</Mono>
          </span>
        ) : (
          t('dashboard.attention.failed')
        );
      case 'sourceActive':
        return t('dashboard.attention.sourceActive');
      case 'warnings':
        return t('units.warnings', { count: item.warnings });
    }
  };

  const hintText = (item: AttentionItem): string | null => {
    switch (item.reason) {
      case 'review':
        return t('dashboard.attention.reviewHint');
      case 'failed':
        return t('dashboard.attention.failedHint');
      case 'sourceActive':
        return t('dashboard.attention.sourceActiveHint');
      case 'warnings':
        return t('dashboard.attention.warningsHint');
      default:
        return null;
    }
  };

  return (
    <Card flush className={cn('overflow-hidden', className)}>
      <CardHeader
        divided
        actions={
          loading ? undefined : actionable > 0 ? (
            <Badge tone={headTone} glow dot pulse={headTone === 'brand'} className="tabular">
              <span aria-hidden="true">{actionable}</span>
              <span className="sr-only">{t('dashboard.attention.count', { count: actionable })}</span>
            </Badge>
          ) : items.length > 0 ? (
            <Badge tone="success" dot>
              {t('dashboard.attention.clear')}
            </Badge>
          ) : undefined
        }
      >
        <CardTitle>{t('dashboard.attention.title')}</CardTitle>
        <CardDescription>{t('dashboard.attention.description')}</CardDescription>
      </CardHeader>

      {loading ? (
        <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]" role="status" aria-label={t('common.loading')}>
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-6 py-3.5">
              <Skeleton shape="circle" className="h-2 w-2" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-40" />
            </li>
          ))}
        </ul>
      ) : error && migrations.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="error"
          title={t('dashboard.attention.error.title')}
          description={t('empty.couldNotLoad.description')}
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="attention"
          title={t('dashboard.attention.empty.title')}
          description={t('dashboard.attention.empty.description')}
        />
      ) : (
        <>
          <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
            {visible.map((item) => {
              const m = item.migration;
              const tone = TONE[item.reason];
              const hint = hintText(item);
              const isRunning = item.reason === 'running';
              const pct = m.total_steps > 0 ? percent(m.completed_steps, m.total_steps) : 0;
              return (
                <li key={m.id}>
                  <Link
                    to={`/migrations/${m.id}`}
                    className={cn(
                      'group flex items-center gap-3 px-6 py-3 transition-colors',
                      'hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-white/[0.03] dark:focus-visible:bg-white/[0.04]',
                    )}
                  >
                    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
                      {isRunning && (
                        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 motion-reduce:hidden', badgeDotClasses[tone])} />
                      )}
                      <span className={cn('relative inline-flex h-2 w-2 rounded-full', badgeDotClasses[tone])} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <Mono className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{m.account_username}</Mono>
                        <span
                          className={cn(
                            'min-w-0 truncate text-sm',
                            item.reason === 'warnings' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-300',
                          )}
                        >
                          {reasonText(item)}
                        </span>
                        {item.reason !== 'warnings' && item.warnings > 0 && (
                          <Badge tone="warning" size="sm" className="tabular">
                            {t('units.warnings', { count: item.warnings })}
                          </Badge>
                        )}
                      </div>
                      {isRunning ? (
                        <div className="mt-2 flex items-center gap-3">
                          <ProgressBar value={pct} live size="xs" showValue label={t('a11y.progress')} className="max-w-xs flex-1" />
                          {m.current_step && (
                            <bdi className="truncate text-xs text-slate-500 dark:text-slate-400">{m.current_step}</bdi>
                          )}
                        </div>
                      ) : hint ? (
                        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{hint}</p>
                      ) : null}
                    </div>

                    <span className="hidden text-xs font-medium text-slate-400 transition-colors group-hover:text-brand-700 dark:text-slate-500 dark:group-hover:text-brand-300 sm:inline">
                      {t('common.open')}
                    </span>
                    <ChevronRightIcon
                      className="flip-rtl h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-brand-700 dark:text-slate-600 dark:group-hover:text-brand-300"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
          {items.length > VISIBLE && (
            <div className="border-t border-slate-100 px-6 py-2 dark:border-white/[0.06]">
              <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                {expanded ? t('dashboard.attention.showLess') : t('dashboard.attention.showAll', { count: items.length })}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default AttentionCard;
