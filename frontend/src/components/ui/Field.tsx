import { Children, cloneElement, isValidElement, useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface FieldProps {
  label: ReactNode;
  /** Id for the control. Auto-generated when omitted; the child control receives it via `id`. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Optional right-aligned element next to the label (e.g. "Optional", a link). */
  labelAddon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Label + control + hint/error. Wraps Input/Select/Textarea and injects `id`, `aria-describedby`
 * and `invalid` into a single child control.
 */
export function Field({ label, htmlFor, hint, error, required, labelAddon, className, children }: FieldProps) {
  const autoId = useId();
  const id = htmlFor ?? `field-${autoId}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const child = Children.only(children);
  const control = isValidElement(child)
    ? cloneElement(child as React.ReactElement<Record<string, unknown>>, {
        id: (child.props as Record<string, unknown>).id ?? id,
        'aria-describedby': [errorId, hintId].filter(Boolean).join(' ') || undefined,
        ...(error ? { invalid: true } : {}),
      })
    : child;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
          {required && <span className="ml-0.5 text-rose-500" aria-hidden="true">*</span>}
        </label>
        {labelAddon && <span className="text-xs text-slate-400 dark:text-slate-500">{labelAddon}</span>}
      </div>
      {control}
      {error ? (
        <p id={errorId} className="text-xs text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export default Field;
