import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Monospace text — use for IPs, hosts, ids, paths. */
  mono?: boolean;
  /** Visual error state (adds rose border). Field passes this automatically. */
  invalid?: boolean;
  size?: 'sm' | 'md';
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
}

export const inputBaseClasses =
  'block w-full rounded-lg border bg-white text-slate-900 shadow-sm transition-colors ' +
  'placeholder:text-slate-400 hover:border-slate-300 ' +
  'focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ' +
  'dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-slate-600 ' +
  'dark:focus:border-indigo-400 dark:focus:ring-indigo-400/30 dark:disabled:bg-slate-800';

export const inputBorderClasses = (invalid?: boolean) =>
  invalid
    ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/30 dark:border-rose-500/70'
    : 'border-slate-200 dark:border-slate-700';

export const inputSizeClasses = { sm: 'h-8 px-2.5 text-xs', md: 'h-9 px-3 text-sm' };

/**
 * Text input. Wrap in `<Field>` to get a label, hint and error.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono, invalid, size = 'md', leftIcon, rightSlot, className, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        inputBaseClasses,
        inputBorderClasses(invalid),
        inputSizeClasses[size],
        mono && 'font-mono',
        leftIcon && (size === 'sm' ? 'pl-8' : 'pl-9'),
        rightSlot && 'pr-9',
        className,
      )}
      {...rest}
    />
  );
  if (!leftIcon && !rightSlot) return input;
  return (
    <div className="relative">
      {leftIcon && (
        <span className={cn('pointer-events-none absolute inset-y-0 left-0 flex items-center text-slate-400 dark:text-slate-500 [&_svg]:h-4 [&_svg]:w-4', size === 'sm' ? 'pl-2.5' : 'pl-3')} aria-hidden="true">
          {leftIcon}
        </span>
      )}
      {input}
      {rightSlot && <span className="absolute inset-y-0 right-0 flex items-center pr-2 text-slate-400 dark:text-slate-500">{rightSlot}</span>}
    </div>
  );
});

export default Input;
