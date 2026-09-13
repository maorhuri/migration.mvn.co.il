import type { ComponentType, ReactNode, SVGProps } from 'react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  /** Heroicon component (outline). */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  title: ReactNode;
  description?: ReactNode;
  /** Primary action (a `<Button variant="primary">`). */
  action?: ReactNode;
  /** Secondary link/button. */
  secondaryAction?: ReactNode;
  /** Compact variant for inside cards/tables. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Designed empty state for lists/tables. Always give it a next step (`action`)
 * unless the list is read-only.
 */
export function EmptyState({ icon: Icon, title, description, action, secondaryAction, size = 'md', className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', size === 'md' ? 'px-6 py-14' : 'px-4 py-8', className)}>
      {Icon && (
        <div
          className={cn(
            'mb-4 flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500',
            size === 'md' ? 'h-12 w-12' : 'h-10 w-10',
          )}
        >
          <Icon className={size === 'md' ? 'h-6 w-6' : 'h-5 w-5'} aria-hidden="true" />
        </div>
      )}
      <h3 className={cn('font-semibold tracking-tight text-slate-900 dark:text-slate-100', size === 'md' ? 'text-base' : 'text-sm')}>{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-5 flex items-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
