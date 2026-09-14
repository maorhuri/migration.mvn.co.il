import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'blue' | 'orange' | 'cyan' | 'lime';
export type BadgeSize = 'sm' | 'md' | 'lg';

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
  /** Soft tinted halo around the chip (the one live/important state on a card). */
  glow?: boolean;
  children?: ReactNode;
}

export const badgeToneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.1]',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
  info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30',
  cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  lime: 'bg-lime-50 text-lime-700 ring-lime-200 dark:bg-lime-500/15 dark:text-lime-300 dark:ring-lime-500/30',
};

export const badgeDotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-400 dark:bg-slate-500',
  brand: 'bg-brand-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-sky-500',
  violet: 'bg-violet-500',
  blue: 'bg-blue-500',
  orange: 'bg-orange-500',
  cyan: 'bg-cyan-500',
  lime: 'bg-lime-500',
};

const glowClasses: Record<BadgeTone, string> = {
  neutral: '[--glow:rgb(100_116_139_/_0.15)]',
  brand: '[--glow:rgb(198_44_133_/_0.18)]',
  success: '[--glow:rgb(16_185_129_/_0.18)]',
  warning: '[--glow:rgb(245_158_11_/_0.2)]',
  danger: '[--glow:rgb(244_63_94_/_0.18)]',
  info: '[--glow:rgb(14_165_233_/_0.18)]',
  violet: '[--glow:rgb(139_92_246_/_0.18)]',
  blue: '[--glow:rgb(59_130_246_/_0.18)]',
  orange: '[--glow:rgb(249_115_22_/_0.18)]',
  cyan: '[--glow:rgb(6_182_212_/_0.18)]',
  lime: '[--glow:rgb(132_204_22_/_0.18)]',
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'h-5 px-1.5 text-2xs gap-1 [&_svg]:h-3 [&_svg]:w-3',
  md: 'h-6 px-2 text-xs gap-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5',
  lg: 'h-7 px-2.5 text-sm gap-1.5 [&_svg]:h-4 [&_svg]:w-4',
};

/**
 * Small label pill. Use for status, panel type, counts and flags — never for long text.
 * Status must always be a Badge with `dot` (see StatusBadge).
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', size = 'md', dot, pulse, icon, mono, glow, className, children, ...rest },
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
        glow && cn('shadow-[0_0_0_3px_var(--glow)]', glowClasses[tone]),
        className,
      )}
      {...rest}
    >
      {dot && (
        <span className="relative inline-flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          {pulse && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 motion-reduce:hidden', badgeDotClasses[tone])} />}
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', badgeDotClasses[tone])} />
        </span>
      )}
      {icon && <span className="inline-flex shrink-0" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
});

export default Badge;
