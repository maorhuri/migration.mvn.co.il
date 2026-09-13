import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Monospace value (IP, host, id, path). */
  mono?: boolean;
  /** Let the value span the full width (long text). */
  span?: boolean;
}

export interface KeyValueProps {
  items: KeyValueItem[];
  /** `rows` = label left / value right per row (cards). `grid` = label above value in columns (info panels). */
  layout?: 'rows' | 'grid';
  /** Columns for the `grid` layout at lg. */
  columns?: 2 | 3 | 4 | 6;
  /** Monospace for every value. */
  mono?: boolean;
  /** Divide rows with hairlines. */
  divided?: boolean;
  className?: string;
}

const gridCols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4', 6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6' };

/**
 * Definition list. `rows` for compact key/value in cards, `grid` for server-info panels.
 */
export function KeyValue({ items, layout = 'rows', columns = 4, mono, divided, className }: KeyValueProps) {
  if (layout === 'grid') {
    return (
      <dl className={cn('grid gap-x-6 gap-y-4', gridCols[columns], className)}>
        {items.map((it, i) => (
          <div key={i} className={cn('min-w-0', it.span && 'col-span-full')}>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{it.label}</dt>
            <dd className={cn('mt-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100', (mono || it.mono) && 'font-mono text-[13px]')}>
              {it.value ?? <span className="text-slate-400 dark:text-slate-500">—</span>}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cn(divided ? 'divide-y divide-slate-100 dark:divide-slate-800' : 'space-y-2', className)}>
      {items.map((it, i) => (
        <div key={i} className={cn('flex items-start justify-between gap-4 text-sm', divided && 'py-2 first:pt-0 last:pb-0')}>
          <dt className="shrink-0 text-slate-500 dark:text-slate-400">{it.label}</dt>
          <dd className={cn('min-w-0 truncate text-right font-medium text-slate-900 dark:text-slate-100', (mono || it.mono) && 'font-mono text-[13px]')}>
            {it.value ?? <span className="text-slate-400 dark:text-slate-500">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default KeyValue;
