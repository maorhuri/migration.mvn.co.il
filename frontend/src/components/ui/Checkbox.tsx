import { forwardRef, type InputHTMLAttributes } from 'react';
import { CheckIcon, MinusIcon } from '@heroicons/react/16/solid';
import { cn } from '../../lib/cn';

/** Classes for a native `<input type="checkbox">` when a custom box is not wanted (dense tables). */
export const checkboxClasses =
  'h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-700 dark:border-white/[0.15] dark:accent-brand-600 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-brand-300 dark:focus-visible:ring-offset-slate-900';

export type CheckboxProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * Custom-drawn checkbox: the native input stays (sr-only) so every prop, ref and
 * `indeterminate` (set via ref) keep working; the box is a peer-styled span.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ className, ...rest }, ref) {
  return (
    <label className={cn('relative inline-flex h-4 w-4 shrink-0 cursor-pointer', className)}>
      <input ref={ref} type="checkbox" className="peer sr-only" {...rest} />
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-0 rounded-[5px] border border-slate-300 bg-white transition-colors',
          'peer-checked:border-brand-700 peer-checked:bg-brand-700 peer-indeterminate:border-brand-700 peer-indeterminate:bg-brand-700',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-brand-300 dark:peer-focus-visible:ring-offset-slate-900',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
          'dark:border-white/[0.15] dark:bg-slate-950/40 dark:peer-checked:border-brand-600 dark:peer-checked:bg-brand-600 dark:peer-indeterminate:border-brand-600 dark:peer-indeterminate:bg-brand-600',
        )}
      />
      <CheckIcon
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-4 w-4 scale-0 text-white transition-transform duration-150 peer-checked:scale-100"
      />
      <MinusIcon
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-4 w-4 scale-0 text-white transition-transform duration-150 peer-indeterminate:scale-100"
      />
    </label>
  );
});

export default Checkbox;
