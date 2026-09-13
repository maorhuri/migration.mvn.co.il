import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'blue' | 'orange';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Render a status dot before the label. */
  dot?: boolean;
  /** Animate the dot (use for "running"/"live"). */
  pulse?: boolean;
  /** Optional leading icon (16px). */
  icon?: ReactNode;
  /** Monospace label (versions, ids). */
  mono?: boolean;
  children?: ReactNode;
}

export const badgeToneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  brand: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
  info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30',
};

export const badgeDotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-400 dark:bg-slate-500',
  brand: 'bg-indigo-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-sky-500',
  violet: 'bg-violet-500',
  blue: 'bg-blue-500',
  orange: 'bg-orange-500',
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'h-5 px-1.5 text-2xs gap-1 [&_svg]:h-3 [&_svg]:w-3',
  md: 'h-6 px-2 text-xs gap-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5',
};

/**
 * Small label pill. Use for status, panel type, counts and flags — never for long text.
 * Status must always be a Badge with `dot` (see StatusBadge).
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', size = 'md', dot, pulse, icon, mono, className, children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md font-medium ring-1 ring-inset',
        sizeClasses[size],
        badgeToneClasses[tone],
        mono && 'font-mono',
        className,
      )}
      {...rest}
    >
      {dot && (
        <span className="relative inline-flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          {pulse && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', badgeDotClasses[tone])} />}
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', badgeDotClasses[tone])} />
        </span>
      )}
      {icon && <span className="inline-flex shrink-0" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
});

export default Badge;
