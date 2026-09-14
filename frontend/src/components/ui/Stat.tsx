import type { ComponentType, ReactNode, SVGProps } from 'react';
import { cn } from '../../lib/cn';
import { useCountUp } from '../../lib/useCountUp';
import { surfaceClasses } from './Card';
import { Skeleton } from './Skeleton';

export type StatTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'blue' | 'orange';

export interface StatProps {
  label: ReactNode;
  /** Big tabular figure. Numbers count up on change. */
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: StatTone;
  /** Render as a link/button target: adds hover state. */
  interactive?: boolean;
  /** Loading skeleton. */
  loading?: boolean;
  /** Muted value (nothing to report: 0 failed, 0 warnings). */
  quiet?: boolean;
  valueClassName?: string;
  /** Rendered at the end of the value row (a `<Sparkline />`). */
  trend?: ReactNode;
  className?: string;
}

const toneIcon: Record<StatTone, string> = {
  neutral: 'text-slate-400 dark:text-slate-500',
  brand: 'text-brand-600 dark:text-brand-300',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  danger: 'text-rose-500',
  info: 'text-sky-500',
  violet: 'text-violet-500',
  blue: 'text-blue-500',
  orange: 'text-orange-500',
};

const toneLine: Record<StatTone, string> = {
  neutral: 'via-slate-300/60 dark:via-white/10',
  brand: 'via-brand-500/50',
  success: 'via-emerald-500/50',
  warning: 'via-amber-500/50',
  danger: 'via-rose-500/50',
  info: 'via-sky-500/50',
  violet: 'via-violet-500/50',
  blue: 'via-blue-500/50',
  orange: 'via-orange-500/50',
};

function CountUp({ value }: { value: number }) {
  const n = useCountUp(value);
  return <>{n}</>;
}

/**
 * KPI tile: eyebrow label, big tabular figure (28px), optional hint, tone-colored icon and a
 * faint tone hairline at the bottom. Its own card; place 3-4 in a `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`.
 */
export function Stat({ label, value, hint, icon: Icon, tone = 'neutral', interactive, loading, quiet, valueClassName, trend, className }: StatProps) {
  return (
    <div
      className={cn(
        surfaceClasses,
        'relative overflow-hidden p-6',
        interactive && 'cursor-pointer transition-colors hover:border-slate-300 dark:hover:border-white/[0.16]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow truncate">{label}</p>
        {Icon && <Icon className={cn('h-4 w-4 shrink-0', toneIcon[tone])} aria-hidden="true" />}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-16" />
      ) : (
        <div className="mt-3 flex items-end justify-between gap-3">
          <p
            className={cn(
              'text-[28px] font-semibold leading-none tabular',
              quiet ? 'text-slate-300 dark:text-slate-600' : 'text-slate-900 dark:text-slate-50',
              valueClassName,
            )}
          >
            {typeof value === 'number' ? <CountUp value={value} /> : value}
          </p>
          {trend && <div className="shrink-0 text-slate-400 dark:text-slate-500">{trend}</div>}
        </div>
      )}
      {hint && (
        <p className="mt-2 truncate text-xs text-slate-500 dark:text-slate-400" title={typeof hint === 'string' ? hint : undefined}>
          {hint}
        </p>
      )}
      <span aria-hidden="true" className={cn('absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent', toneLine[tone])} />
    </div>
  );
}

export default Stat;
