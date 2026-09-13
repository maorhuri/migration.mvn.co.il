import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  /** Small count/badge on the right of the label. */
  count?: number | string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** `underline` (default, page-level) or `pills` (inside cards / filters). */
  variant?: 'underline' | 'pills';
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Controlled tab list. Only renders the tab strip; render the panel yourself based on `value`.
 * Use `pills` as filter chips (e.g. log level, panel type).
 */
export function Tabs<T extends string = string>({ tabs, value, onChange, variant = 'underline', size = 'md', className }: TabsProps<T>) {
  const underline = variant === 'underline';
  return (
    <div
      role="tablist"
      className={cn(
        'flex items-center',
        underline ? 'gap-1 border-b border-slate-200 dark:border-slate-800' : 'gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap font-medium transition-colors disabled:opacity-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
              size === 'sm' ? 'text-xs' : 'text-sm',
              underline
                ? cn(
                    '-mb-px border-b-2 px-3 py-2.5',
                    active
                      ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-300'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-100',
                  )
                : cn(
                    'rounded-md px-3',
                    size === 'sm' ? 'py-1' : 'py-1.5',
                    active
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
                  ),
            )}
          >
            {tab.icon && <span className="inline-flex [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">{tab.icon}</span>}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-2xs tabular',
                  active ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
