import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronRightIcon, MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { ArrowsRightLeftIcon, KeyIcon, PlusIcon, ServerStackIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { cn } from '../../lib/cn';
import { useT, type T } from '../../lib/i18n';
import { buttonBaseClasses, buttonSizeClasses, buttonVariantClasses } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { Logo } from '../ui/Logo';
import { Mono } from '../ui/Mono';
import { Tooltip } from '../ui/Tooltip';
import { CommandPalette } from './CommandPalette';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';

const APP_VERSION = '1.0.0';
const ENVIRONMENT = 'migration.mvn.co.il';

interface NavItem {
  /** Translation key under nav.* */
  key: string;
  href: string;
  icon: typeof ServerStackIcon;
  end?: boolean;
}

const NAV_GROUPS: { key: string; items: NavItem[] }[] = [
  { key: 'nav.overview', items: [{ key: 'nav.dashboard', href: '/', icon: Squares2X2Icon, end: true }] },
  {
    key: 'nav.infrastructure',
    items: [
      { key: 'nav.servers', href: '/servers', icon: ServerStackIcon },
      { key: 'nav.sshKeys', href: '/ssh-keys', icon: KeyIcon },
    ],
  },
  { key: 'nav.operations', items: [{ key: 'nav.migrations', href: '/migrations', icon: ArrowsRightLeftIcon }] },
];

const ROUTE_KEYS: Record<string, string> = {
  '': 'nav.dashboard',
  servers: 'nav.servers',
  migrations: 'nav.migrations',
  'ssh-keys': 'nav.sshKeys',
  new: 'nav.newMigration',
};

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

/**
 * Derive breadcrumb items from a pathname: /servers/abc -> Servers. Unknown segments after the
 * first (ids) are dropped; the page header carries the entity name.
 */
export function breadcrumbFromPath(pathname: string, t: T): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [{ label: t('nav.dashboard') }];
  const crumbs: BreadcrumbItem[] = [];
  let acc = '';
  segments.forEach((seg, i) => {
    acc += `/${seg}`;
    const key = ROUTE_KEYS[seg];
    if (!key && i > 0) return;
    crumbs.push({ label: key ? t(key) : seg, to: acc });
  });
  if (crumbs.length > 0) crumbs[crumbs.length - 1].to = undefined;
  return crumbs;
}

/**
 * Application chrome: fixed 264px sidebar (icon rail under `lg`) with the brand, the pinned
 * environment card, the primary action and grouped navigation; slim top bar with route
 * breadcrumb, Cmd+K trigger, language and theme toggles. Children render in the main area with 24px padding.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const crumbs = useMemo(() => breadcrumbFromPath(location.pathname, t), [location.pathname, t]);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPaletteOpen((v) => !v);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  const primaryLink = cn(buttonBaseClasses, buttonVariantClasses.primary, buttonSizeClasses.md, 'w-full');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Sidebar */}
      <aside
        className="fixed inset-y-0 start-0 z-30 flex w-16 flex-col border-e border-slate-200 bg-white dark:border-white/[0.06] dark:bg-slate-950 lg:w-[264px]"
        aria-label={t('a11y.sidebar')}
      >
        <div className="flex h-14 items-center px-3 lg:px-5">
          <Link
            to="/"
            className="flex items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-brand-300 dark:focus-visible:ring-offset-slate-900"
            aria-label={t('a11y.home')}
          >
            <Logo wordmark={false} className="lg:hidden" />
            <Logo className="hidden lg:inline-flex" />
          </Link>
        </div>

        {/* Pinned context: which environment this console controls. */}
        <div className="mx-3 mt-3 hidden items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03] lg:mx-4 lg:flex">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="min-w-0">
            <span className="eyebrow block">{t('brand.env')}</span>
            <Mono className="block text-xs text-slate-700 dark:text-slate-200">{ENVIRONMENT}</Mono>
          </span>
        </div>
        <div className="mt-3 flex justify-center lg:hidden">
          <Tooltip content={`${t('brand.env')} · ${ENVIRONMENT}`} side="end">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 dark:border-white/[0.06] dark:bg-white/[0.03]" aria-label={`${t('brand.env')} ${ENVIRONMENT}`} role="img">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          </Tooltip>
        </div>

        <div className="px-2 pt-3 lg:px-4">
          <Tooltip content={t('nav.newMigration')} side="end" className="w-full lg:hidden">
            <Link to="/migrations/new" aria-label={t('nav.newMigration')} className={cn(primaryLink, 'h-10 px-0')}>
              <PlusIcon className="h-5 w-5" aria-hidden="true" />
            </Link>
          </Tooltip>
          <Link to="/migrations/new" className={cn(primaryLink, 'hidden lg:inline-flex')}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            {t('nav.newMigration')}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4 lg:px-4" aria-label={t('a11y.mainNav')}>
          {NAV_GROUPS.map((group) => (
            <div key={group.key} className="mb-5">
              <div className="eyebrow mb-1.5 hidden px-2.5 lg:block">{t(group.key)}</div>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      to={item.href}
                      end={item.end}
                      title={t(item.key)}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                          'justify-center lg:justify-start',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-brand-300 dark:focus-visible:ring-offset-slate-900',
                          isActive
                            ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200 before:absolute before:start-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-brand-600 before:content-[""] dark:before:bg-brand-400'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon
                            className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-brand-700 dark:text-brand-300' : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300')}
                            aria-hidden="true"
                          />
                          <span className="hidden truncate lg:block">{t(item.key)}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3 dark:border-white/[0.06] lg:px-5">
          <span dir="ltr" className="hidden text-2xs text-slate-400 dark:text-slate-500 lg:block">
            {t('brand.version', { version: APP_VERSION })}
          </span>
          <span dir="ltr" className="block text-center text-2xs text-slate-400 dark:text-slate-500 lg:hidden">
            v{APP_VERSION}
          </span>
        </div>
      </aside>

      {/* Main */}
      <div className="ps-16 lg:ps-[264px]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-md dark:border-white/[0.06] dark:bg-slate-950/80 sm:px-6">
          <nav aria-label={t('a11y.breadcrumb')} className="flex min-w-0 items-center gap-1 text-sm">
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                {i > 0 && <ChevronRightIcon className="flip-rtl h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true" />}
                {c.to ? (
                  <Link to={c.to} className="truncate rounded text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
                    {c.label}
                  </Link>
                ) : (
                  <span className="truncate font-medium text-slate-900 dark:text-slate-100" aria-current="page">
                    {c.label}
                  </span>
                )}
              </span>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-9 w-72 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 pe-1.5 ps-3 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-white/[0.16] dark:hover:text-slate-200 dark:focus-visible:ring-brand-300 dark:focus-visible:ring-offset-slate-900 sm:flex"
            >
              <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1 truncate text-start">{t('palette.placeholder')}</span>
              <span dir="ltr" className="flex items-center gap-0.5">
                <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label={t('a11y.search')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-100 dark:focus-visible:ring-brand-300 sm:hidden"
            >
              <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
            </button>
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] p-6">
          <div key={location.pathname} className="motion-safe:animate-fade-in">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default AppShell;
