import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/16/solid';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';

export interface Crumb {
  label: ReactNode;
  to?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Small brand-colored label above the title (e.g. "Server", "Migration"). */
  eyebrow?: ReactNode;
  /** Breadcrumb trail rendered above the title. The app shell already shows a route breadcrumb; use this for extra depth (e.g. server name). */
  breadcrumb?: Crumb[];
  /** Buttons at the end of the row (one solid brand primary action). */
  actions?: ReactNode;
  /** Badges next to the title (status, panel). */
  meta?: ReactNode;
  /** Back link target. */
  backTo?: string;
  className?: string;
}

/**
 * Page title block: bold title + the page's one primary action. Always the first element of a
 * page; the page then continues with `space-y-6` sections. It rises in first on page load
 * (`--i` 0); the sections that follow stagger from `--i` 1.
 */
export function PageHeader({ title, description, eyebrow, breadcrumb, actions, meta, backTo, className }: PageHeaderProps) {
  const t = useT();
  return (
    <header className={cn('flex flex-col gap-4 motion-safe:animate-rise stagger sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label={t('a11y.breadcrumb')} className="mb-2 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            {breadcrumb.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRightIcon className="flip-rtl h-3.5 w-3.5 text-slate-300 dark:text-slate-600" aria-hidden="true" />}
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
        {eyebrow && !breadcrumb && <p className="eyebrow mb-1 text-brand-700 dark:text-brand-300">{eyebrow}</p>}
        <div className="flex flex-wrap items-center gap-3">
          {backTo && (
            <Link
              to={backTo}
              aria-label={t('a11y.back')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-slate-100"
            >
              <ChevronLeftIcon className="flip-rtl h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">{title}</h1>
          {meta && <div className="flex items-center gap-2">{meta}</div>}
        </div>
        {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export default PageHeader;
