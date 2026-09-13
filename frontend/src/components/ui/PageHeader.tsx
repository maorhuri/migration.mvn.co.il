import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon } from '@heroicons/react/16/solid';
import { cn } from '../../lib/cn';

export interface Crumb {
  label: ReactNode;
  to?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Small text above the title (e.g. "Server", "Migration"). */
  eyebrow?: ReactNode;
  /** Breadcrumb trail rendered above the title. The app shell already shows a route breadcrumb; use this for extra depth (e.g. server name). */
  breadcrumb?: Crumb[];
  /** Buttons on the right. */
  actions?: ReactNode;
  /** Badges next to the title (status, panel). */
  meta?: ReactNode;
  /** Back link target. */
  backTo?: string;
  className?: string;
}

/**
 * Page title block. Always the first element of a page; the page then continues with
 * `space-y-6` sections.
 */
export function PageHeader({ title, description, eyebrow, breadcrumb, actions, meta, backTo, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            {breadcrumb.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRightIcon className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" aria-hidden="true" />}
                {c.to ? (
                  <Link to={c.to} className="rounded transition-colors hover:text-slate-900 dark:hover:text-slate-100">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-slate-700 dark:text-slate-300">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        {eyebrow && !breadcrumb && (
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{eyebrow}</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {backTo && (
            <Link
              to={backTo}
              aria-label="Back"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <ChevronRightIcon className="h-4 w-4 rotate-180" aria-hidden="true" />
            </Link>
          )}
          <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{title}</h1>
          {meta && <div className="flex items-center gap-2">{meta}</div>}
        </div>
        {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export default PageHeader;
