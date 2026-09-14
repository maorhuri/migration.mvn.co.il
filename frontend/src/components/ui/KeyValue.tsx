import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Mono } from './Mono';

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Monospace, LTR value (IP, host, id, path). */
  mono?: boolean;
  /** Let the value span the full width (long text). */
  span?: boolean;
}

export interface KeyValueProps {
  items: KeyValueItem[];
  /** `rows` = label start / value end per row (cards). `grid` = label above value in columns (info panels). */
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

function Value({ value, mono }: { value: ReactNode; mono?: boolean }) {
  if (value === null || value === undefined || value === '') return <span className="text-slate-400 dark:text-slate-500">—</span>;
  return mono ? <Mono className="text-[13px]">{value}</Mono> : <>{value}</>;
}

/**
 * Definition list. `rows` for compact key/value in cards, `grid` for server-info panels.
 */
export function KeyValue({ items, layout = 'rows', columns = 4, mono, divided, className }: KeyValueProps) {
  if (layout === 'grid') {
    return (
      <dl className={cn('grid gap-x-6 gap-y-4', gridCols[columns], className)}>
        {items.map((it, i) => (
          <div key={i} className={cn('min-w-0', it.span && 'col-span-full')}>
            <dt className="eyebrow">{it.label}</dt>
            <dd className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              <Value value={it.value} mono={mono || it.mono} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cn(divided ? 'divide-y divide-slate-100 dark:divide-white/[0.06]' : 'space-y-2', className)}>
      {items.map((it, i) => (
        <div key={i} className={cn('flex items-start justify-between gap-4 text-sm', divided && 'py-2 first:pt-0 last:pb-0')}>
          <dt className="shrink-0 text-slate-500 dark:text-slate-400">{it.label}</dt>
          <dd className="min-w-0 truncate text-end font-medium text-slate-900 dark:text-slate-100">
            <Value value={it.value} mono={mono || it.mono} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default KeyValue;
