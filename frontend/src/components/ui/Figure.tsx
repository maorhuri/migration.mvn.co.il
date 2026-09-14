import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useCountUp } from '../../lib/useCountUp';

export type FigureTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

export interface FigureProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: FigureTone;
  /** Monospace value (durations, sizes, ids). */
  mono?: boolean;
  /** The one live number on the page: brand-colored. */
  live?: boolean;
  /** text-lg / text-2xl / text-4xl. */
  size?: 'sm' | 'md' | 'lg';
  /** Animate numeric values on change. */
  countUp?: boolean;
  className?: string;
}

const toneClasses: Record<FigureTone, string> = {
  neutral: 'text-slate-900 dark:text-slate-50',
  brand: 'text-brand-700 dark:text-brand-300',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-rose-600 dark:text-rose-400',
};

const sizeClasses = { sm: 'text-lg', md: 'text-2xl', lg: 'text-4xl' };

const StripContext = createContext(false);

function CountUp({ value }: { value: number }) {
  const n = useCountUp(value);
  return <>{n}</>;
}

/**
 * Eyebrow label + big tabular value. Inside a `FigureStrip` it renders `dt`/`dd`;
 * standalone it is a plain block (put it in a Card).
 */
export function Figure({ label, value, hint, tone = 'neutral', mono, live, size = 'md', countUp, className }: FigureProps) {
  const inStrip = useContext(StripContext);
  const Label = inStrip ? 'dt' : 'span';
  const Value = inStrip ? 'dd' : 'span';
  return (
    <div className={cn('min-w-0', inStrip && 'px-4 py-3', className)}>
      <Label className="eyebrow block truncate">{label}</Label>
      <Value
        className={cn(
          'mt-1 block truncate font-semibold leading-tight tabular',
          sizeClasses[size],
          mono && 'font-mono',
          live ? 'text-brand-700 dark:text-brand-300' : toneClasses[tone],
        )}
      >
        {countUp && typeof value === 'number' ? <CountUp value={value} /> : value}
      </Value>
      {hint && <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </div>
  );
}

const stripColumns = {
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  6: 'sm:grid-cols-3 xl:grid-cols-6',
};

/** A quiet strip of Figures (2 columns, then `columns` from sm/xl: 3, 4 or 6) with hairline dividers. */
export function FigureStrip({ children, columns = 6, className }: { children: ReactNode; columns?: 3 | 4 | 6; className?: string }) {
  return (
    <StripContext.Provider value={true}>
      <dl
        className={cn(
          'grid grid-cols-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-slate-50/60 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse',
          stripColumns[columns],
          'dark:divide-white/[0.06] dark:border-white/[0.06] dark:bg-white/[0.02]',
          className,
        )}
      >
        {children}
      </dl>
    </StripContext.Provider>
  );
}

export default Figure;
