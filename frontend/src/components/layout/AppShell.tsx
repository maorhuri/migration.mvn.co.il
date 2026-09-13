import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronRightIcon, MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { ArrowsRightLeftIcon, KeyIcon, PlusIcon, ServerStackIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { cn } from '../../lib/cn';
import { Kbd } from '../ui/Kbd';
import { Tooltip } from '../ui/Tooltip';
import { CommandPalette } from './CommandPalette';
import { ThemeToggle } from './ThemeToggle';

const APP_VERSION = '1.0.0';
const ENVIRONMENT = 'migration.mvn.co.il';

interface NavItem {
  name: string;
  href: string;
  icon: typeof ServerStackIcon;
  end?: boolean;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [{ name: 'Dashboard', href: '/', icon: Squares2X2Icon, end: true }] },
  {
    title: 'Infrastructure',
    items: [
      { name: 'Servers', href: '/servers', icon: ServerStackIcon },
      { name: 'SSH Keys', href: '/ssh-keys', icon: KeyIcon },
    ],
  },
  { title: 'Operations', items: [{ name: 'Migrations', href: '/migrations', icon: ArrowsRightLeftIcon }] },
];

const ROUTE_LABELS: Record<string, string> = {
  '': 'Dashboard',
  servers: 'Servers',
  migrations: 'Migrations',
  'ssh-keys': 'SSH Keys',
  new: 'New',
};

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

/** Derive breadcrumb items from a pathname: /servers/abc -> Servers / Detail. */
export function breadcrumbFromPath(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [{ label: 'Dashboard' }];
  const crumbs: BreadcrumbItem[] = [];
  let acc = '';
  segments.forEach((seg, i) => {
    acc += `/${seg}`;
    const last = i === segments.length - 1;
    const known = ROUTE_LABELS[seg];
    const label = known ?? (i > 0 ? 'Detail' : seg);
    crumbs.push({ label, to: last ? undefined : acc });
  });
  return crumbs;
}

function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-8 w-8 shrink-0', className)} aria-hidden="true">
      <defs>
        <linearGradient id="mt-logo-g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#mt-logo-g)" />
      <path d="M17 24h24l-6-6" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M47 40H23l6 6" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}

/**
 * Application chrome: fixed 264px sidebar (icon rail under `lg`), slim top bar with route
 * breadcrumb, Cmd+K trigger and theme toggle. Children render in the main area with 24px padding.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const crumbs = useMemo(() => breadcrumbFromPath(location.pathname), [location.pathname]);
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-30 flex w-16 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:w-[264px]"
        aria-label="Sidebar"
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-3 dark:border-slate-800 lg:px-5">
          <Link to="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900" aria-label="Migration Tool home">
            <LogoMark />
            <span className="hidden text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-50 lg:block">Migration Tool</span>
          </Link>
        </div>

        <div className="px-2 pt-4 lg:px-4">
          <Tooltip content="New migration" side="right" className="w-full lg:hidden">
            <Link
              to="/migrations/new"
              aria-label="New migration"
              className="flex h-10 w-full items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:focus-visible:ring-offset-slate-900"
            >
              <PlusIcon className="h-5 w-5" aria-hidden="true" />
            </Link>
          </Tooltip>
          <Link
            to="/migrations/new"
            className="hidden h-9 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:focus-visible:ring-offset-slate-900 lg:flex"
          >
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            New migration
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4 lg:px-4" aria-label="Main">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-5">
              <div className="mb-1.5 hidden px-2 text-2xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 lg:block">{group.title}</div>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      to={item.href}
                      end={item.end}
                      title={item.name}
                      className={({ isActive }) =>
                        cn(
                          'group flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors lg:px-2.5',
                          'justify-center lg:justify-start',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
                          isActive
                            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon
                            className={cn('h-5 w-5 shrink-0', isActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300')}
                            aria-hidden="true"
                          />
                          <span className="hidden truncate lg:block">{item.name}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3 dark:border-slate-800 lg:px-4">
          <div className="hidden items-center justify-between gap-2 lg:flex">
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-2xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
              <span className="truncate">{ENVIRONMENT}</span>
            </span>
            <span className="shrink-0 font-mono text-2xs text-slate-400 dark:text-slate-500">v{APP_VERSION}</span>
          </div>
          <div className="flex justify-center lg:hidden">
            <Tooltip content={`${ENVIRONMENT} · v${APP_VERSION}`} side="right">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-label="Environment online" />
            </Tooltip>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="pl-16 lg:pl-[264px]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 sm:px-6">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                {i > 0 && <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true" />}
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
              className="hidden h-8 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 pl-2.5 pr-1.5 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 dark:focus-visible:ring-offset-slate-900 sm:flex"
            >
              <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
              <span className="w-40 text-left text-xs">Search…</span>
              <span className="flex items-center gap-0.5">
                <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 sm:hidden"
            >
              <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
            </button>
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] p-6">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default AppShell;
