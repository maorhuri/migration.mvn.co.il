import { cn } from '../../lib/cn';

export type ProgressTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface ProgressBarProps {
  /** 0-100. Ignored when `indeterminate`. */
  value?: number;
  tone?: ProgressTone;
  indeterminate?: boolean;
  size?: 'xs' | 'sm' | 'md';
  /** Show "42%" to the right. */
  showValue?: boolean;
  /** Accessible label. */
  label?: string;
  className?: string;
}

const toneBar: Record<ProgressTone, string> = {
  brand: 'bg-indigo-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-sky-500',
  neutral: 'bg-slate-400 dark:bg-slate-500',
};

const sizes = { xs: 'h-1', sm: 'h-1.5', md: 'h-2' };

/**
 * Linear progress. Animates width changes; `indeterminate` shows a sliding bar.
 * Map migration status to tone: running=brand, completed=success, failed=danger.
 */
export function ProgressBar({ value = 0, tone = 'brand', indeterminate, size = 'sm', showValue, label, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : clamped}
        className={cn('relative w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700', sizes[size])}
      >
        {indeterminate ? (
          <div className={cn('absolute inset-y-0 w-1/3 animate-indeterminate rounded-full', toneBar[tone])} />
        ) : (
          <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', toneBar[tone])} style={{ width: `${clamped}%` }} />
        )}
      </div>
      {showValue && !indeterminate && (
        <span className="w-10 shrink-0 text-right text-xs font-medium tabular text-slate-600 dark:text-slate-300">{clamped}%</span>
      )}
    </div>
  );
}

export default ProgressBar;
