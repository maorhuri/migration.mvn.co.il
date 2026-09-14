import type { ReactNode } from 'react';
import { CheckIcon } from '@heroicons/react/16/solid';
import { cn } from '../../lib/cn';
import { Checkbox } from './Checkbox';

export interface ChecklistProps {
  /** Renders a segmented progress bar above the list. */
  progress?: { done: number; total: number };
  children: ReactNode;
  className?: string;
}

/** Ordered checklist (cutover steps). Wrap in a Card; items are `<ChecklistItem>`. */
export function Checklist({ progress, children, className }: ChecklistProps) {
  return (
    <div className={className}>
      {progress && progress.total > 0 && (
        <div className="mb-4 flex gap-1" aria-hidden="true">
          {Array.from({ length: progress.total }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors duration-300',
                i < progress.done ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-white/10',
              )}
            />
          ))}
        </div>
      )}
      <ol className="divide-y divide-slate-100 dark:divide-white/[0.06]">{children}</ol>
    </div>
  );
}

export interface ChecklistItemProps {
  /** 1-based number shown in the circle until done. */
  index: number;
  title: ReactNode;
  done: boolean;
  /** When given, a checkbox at the end lets the operator tick the step manually. */
  onToggle?: () => void;
  /** aria-label for the checkbox. */
  toggleLabel?: string;
  description?: ReactNode;
  /** A button or link for this step (rendered under the description). */
  action?: ReactNode;
  /** Extra content (a CodeBlock, a hint). */
  children?: ReactNode;
}

export function ChecklistItem({ index, title, done, onToggle, toggleLabel, description, action, children }: ChecklistItemProps) {
  return (
    <li className="flex gap-4 py-4 first:pt-0 last:pb-0">
      <span
        aria-hidden="true"
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
          done ? 'bg-emerald-500 text-white' : 'border border-slate-300 text-slate-500 dark:border-white/[0.15] dark:text-slate-400',
        )}
      >
        {done ? <CheckIcon className="h-4 w-4" /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-semibold text-slate-900 dark:text-slate-100', done && 'text-slate-500 line-through dark:text-slate-400')}>{title}</p>
        {description && <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</div>}
        {children && <div className="mt-2">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
      {onToggle && (
        <div className="shrink-0 pt-1.5">
          <Checkbox checked={done} onChange={onToggle} aria-label={toggleLabel} />
        </div>
      )}
    </li>
  );
}

export default Checklist;
