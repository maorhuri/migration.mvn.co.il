import type { ComponentType, ReactNode, SVGProps } from 'react';
import { cn } from '../../lib/cn';

export type StatTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'blue' | 'orange';

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: StatTone;
  /** Render as a link/button target: adds hover state. */
  interactive?: boolean;
  /** Loading skeleton. */
  loading?: boolean;
  className?: string;
}

const toneIcon: Record<StatTone, string> = {
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

/**
 * KPI tile: label, big tabular value, optional hint and tinted icon.
 * Place 3-4 in a `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`.
 */
export function Stat({ label, value, hint, icon: Icon, tone = 'neutral', interactive, loading, className }: StatProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900',
        interactive && 'transition-colors hover:border-slate-300 dark:hover:border-slate-700',
        className,
      )}
    >
      {Icon && (
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', toneIcon[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        {loading ? (
          <div className="mt-1.5 h-7 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        ) : (
          <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular text-slate-900 dark:text-slate-50">{value}</p>
        )}
        {hint && <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}

export default Stat;
