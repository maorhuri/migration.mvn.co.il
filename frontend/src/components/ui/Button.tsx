import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /** Stretch to container width. */
  fullWidth?: boolean;
}

export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 active:bg-indigo-700 ' +
    'dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:active:bg-indigo-600',
  secondary:
    'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 active:bg-slate-100 ' +
    'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-700',
  outline:
    'border border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200 ' +
    'dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-700',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200 ' +
    'dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:active:bg-slate-700',
  danger:
    'bg-rose-600 text-white shadow-sm hover:bg-rose-500 active:bg-rose-700 ' +
    'dark:bg-rose-600 dark:hover:bg-rose-500 dark:active:bg-rose-700',
};

export const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5 rounded-md [&_svg]:h-4 [&_svg]:w-4',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg [&_svg]:h-4 [&_svg]:w-4',
  lg: 'h-10 px-4 text-sm gap-2 rounded-lg [&_svg]:h-5 [&_svg]:w-5',
};

export const buttonBaseClasses =
  'inline-flex items-center justify-center whitespace-nowrap font-medium select-none transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 ' +
  'disabled:pointer-events-none disabled:opacity-50';

/**
 * Primary interactive control. Use `variant="primary"` once per view for the main action,
 * `secondary` for the rest, `ghost` for toolbar/inline actions, `danger` for destructive actions
 * (always behind a ConfirmDialog). Pass `loading` while awaiting a request.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, leftIcon, rightIcon, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonBaseClasses, buttonVariantClasses[variant], buttonSizeClasses[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : leftIcon ? <span className="shrink-0 inline-flex" aria-hidden="true">{leftIcon}</span> : null}
      {children}
      {rightIcon && !loading ? <span className="shrink-0 inline-flex" aria-hidden="true">{rightIcon}</span> : null}
    </button>
  );
});

export default Button;
