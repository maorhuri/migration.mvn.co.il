import type { ComponentType, ReactNode, SVGProps } from 'react';
import { cn } from '../../lib/cn';
import { Illustration, type IllustrationName } from './Illustration';

export interface EmptyStateProps {
  /** Heroicon component (outline). Fallback when no `illustration` is given. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Drawn illustration above the title (preferred over `icon`). */
  illustration?: IllustrationName;
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
 * unless the list is read-only. Off-states pair an illustration with three short benefit bullets
 * in `description`.
 */
export function EmptyState({ icon: Icon, illustration, title, description, action, secondaryAction, size = 'md', className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', size === 'md' ? 'px-6 py-14' : 'px-4 py-8', className)}>
      {illustration ? (
        <div className={cn('relative mb-4', size === 'md' ? 'h-24 w-40' : 'h-16 w-28')}>
          <div aria-hidden="true" className="dot-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(closest-side,black,transparent)]" />
          <Illustration name={illustration} className="relative" />
        </div>
      ) : Icon ? (
        <div
          className={cn(
            'mb-4 flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-500',
            size === 'md' ? 'h-12 w-12' : 'h-10 w-10',
          )}
        >
          <Icon className={size === 'md' ? 'h-6 w-6' : 'h-5 w-5'} aria-hidden="true" />
        </div>
      ) : null}
      <h3 className={cn('font-semibold tracking-tight text-slate-900 dark:text-slate-100', size === 'md' ? 'text-base' : 'text-sm')}>{title}</h3>
      {description && <div className="mt-1 max-w-sm text-balance text-sm text-slate-500 dark:text-slate-400">{description}</div>}
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
