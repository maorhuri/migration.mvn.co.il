import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Shape preset. */
  shape?: 'rect' | 'text' | 'circle';
}

/** Placeholder block. Size it with className (`h-4 w-32`). */
export function Skeleton({ shape = 'rect', className, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-slate-200/80 dark:bg-slate-700/60',
        shape === 'circle' ? 'rounded-full' : shape === 'text' ? 'h-3.5 rounded' : 'rounded-md',
        className,
      )}
      {...rest}
    />
  );
}

export interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  /** Include the header band. */
  header?: boolean;
  className?: string;
}

/** Table-shaped skeleton for loading states of lists. Drop it inside `<Card flush>`. */
export function SkeletonTable({ rows = 5, columns = 5, header = true, className }: SkeletonTableProps) {
  const widths = ['w-32', 'w-20', 'w-16', 'w-24', 'w-12', 'w-28', 'w-14'];
  return (
    <div className={cn('w-full', className)} role="status" aria-label="Loading">
      {header && (
        <div className="flex gap-6 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className={cn('h-3', widths[i % widths.length])} />
          ))}
        </div>
      )}
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-6 px-4 py-3">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className={cn('h-3.5', widths[(c + r) % widths.length])} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Card-shaped skeleton (title + lines). */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900', className)} role="status" aria-label="Loading">
      <div className="flex items-center gap-3">
        <Skeleton shape="circle" className="h-9 w-9" />
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cn('h-3', i % 2 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    </div>
  );
}

export default Skeleton;
