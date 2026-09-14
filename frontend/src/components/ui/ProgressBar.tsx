import { cn } from '../../lib/cn';

export type ProgressTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface ProgressBarProps {
  /** 0-100. Ignored when `indeterminate`. */
  value?: number;
  tone?: ProgressTone;
  indeterminate?: boolean;
  /** Bytes are moving right now: the fill flows with the brand gradient. */
  live?: boolean;
  size?: 'xs' | 'sm' | 'md';
  /** Show "42%" at the end. */
  showValue?: boolean;
  /** Accessible label. */
  label?: string;
  className?: string;
}

const toneBar: Record<ProgressTone, string> = {
  brand: 'bg-brand-600 dark:bg-brand-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-sky-500',
  neutral: 'bg-slate-400 dark:bg-slate-500',
};

const sizes = { xs: 'h-1', sm: 'h-1.5', md: 'h-2' };

/**
 * Linear progress. Animates width changes; `indeterminate` shows a sliding bar; `live` makes the
 * fill flow while work is happening. Map migration status to tone: running=brand, completed=success, failed=danger.
 */
export function ProgressBar({ value = 0, tone = 'brand', indeterminate, live, size = 'sm', showValue, label, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : clamped}
        className={cn('relative w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]', sizes[size])}
      >
        {indeterminate ? (
          <div className={cn('absolute inset-y-0 start-0 w-1/3 rounded-full motion-safe:animate-indeterminate rtl:motion-safe:animate-indeterminate-rtl', toneBar[tone])} />
        ) : (
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500 ease-out',
              live ? 'bg-gradient-brand bg-[length:200%_100%] motion-safe:animate-bar-slide' : toneBar[tone],
            )}
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
      {showValue && !indeterminate && (
        <span className="w-10 shrink-0 text-end text-xs font-medium tabular text-slate-600 dark:text-slate-300">{clamped}%</span>
      )}
    </div>
  );
}

export default ProgressBar;
