import { Fragment, useEffect, useMemo, useState } from 'react';
import { Combobox, Dialog, Transition } from '@headlessui/react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon, MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { ArrowsRightLeftIcon, KeyIcon, LanguageIcon, MoonIcon, PlusIcon, ServerStackIcon, Squares2X2Icon, SunIcon } from '@heroicons/react/24/outline';
import { getMigrations, getServers } from '../../api/client';
import type { Migration, Server } from '../../types';
import { cn } from '../../lib/cn';
import { shortId } from '../../lib/format';
import { LANG_LABELS, useLanguage, useT } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
import { Kbd } from '../ui/Kbd';
import { Mono } from '../ui/Mono';
import { PanelMonogram } from '../ui/PanelMonogram';
import { StatusBadge } from '../ui/StatusBadge';
import { Spinner } from '../ui/Spinner';
import { surfaceClasses } from '../ui/Card';

type Icon = typeof ServerStackIcon;

type Item =
  | { kind: 'page'; id: string; label: string; to: string; icon: Icon; keywords?: string }
  | { kind: 'server'; id: string; label: string; to: string; server: Server }
  | { kind: 'migration'; id: string; label: string; to: string; migration: Migration }
  | { kind: 'action'; id: string; label: string; icon: Icon; keywords?: string; run: () => void };

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Cmd+K / Ctrl+K palette. Loads servers and migrations when opened, filters locally,
 * navigates on select. Also exposes the language and theme switches. The shortcut listener lives in AppShell.
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const t = useT();
  const { lang, setLang } = useLanguage();
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [servers, setServers] = useState<Server[]>([]);
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    let cancelled = false;
    setLoading(true);
    Promise.all([getServers().catch(() => [] as Server[]), getMigrations().catch(() => [] as Migration[])])
      .then(([s, m]) => {
        if (cancelled) return;
        setServers(s);
        setMigrations(m);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const serverById = useMemo(() => Object.fromEntries(servers.map((s) => [s.id, s])), [servers]);

  const pages = useMemo<Item[]>(
    () => [
      { kind: 'page', id: 'p-new', label: t('nav.newMigration'), to: '/migrations/new', icon: PlusIcon, keywords: 'new migration create start wizard מיגרציה חדשה' },
      { kind: 'page', id: 'p-dash', label: t('nav.dashboard'), to: '/', icon: Squares2X2Icon, keywords: 'dashboard home overview לוח בקרה' },
      { kind: 'page', id: 'p-servers', label: t('nav.servers'), to: '/servers', icon: ServerStackIcon, keywords: 'servers שרתים' },
      { kind: 'page', id: 'p-migrations', label: t('nav.migrations'), to: '/migrations', icon: ArrowsRightLeftIcon, keywords: 'migrations מיגרציות' },
      { kind: 'page', id: 'p-keys', label: t('nav.sshKeys'), to: '/ssh-keys', icon: KeyIcon, keywords: 'ssh keys מפתחות' },
    ],
    [t],
  );

  const actions = useMemo<Item[]>(() => {
    const other = lang === 'he' ? 'en' : 'he';
    return [
      {
        kind: 'action',
        id: 'a-lang',
        label: t('palette.switchLanguage', { name: LANG_LABELS[other] }),
        icon: LanguageIcon,
        keywords: 'language lang english hebrew עברית שפה',
        run: () => setLang(other),
      },
      {
        kind: 'action',
        id: 'a-theme',
        label: t('palette.toggleTheme'),
        icon: resolvedTheme === 'dark' ? SunIcon : MoonIcon,
        keywords: 'theme dark light ערכת נושא כהה בהיר',
        run: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
      },
    ];
  }, [lang, resolvedTheme, setLang, setTheme, t]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (...parts: (string | undefined)[]) => !q || parts.some((p) => p?.toLowerCase().includes(q));

    const pg = pages.filter((p) => p.kind === 'page' && match(p.label, p.keywords));
    const srv: Item[] = servers
      .filter((s) => match(s.name, s.host, s.panel_type, s.id))
      .slice(0, q ? 8 : 5)
      .map((s) => ({ kind: 'server', id: `s-${s.id}`, label: s.name, to: `/servers/${s.id}`, server: s }));
    const mig: Item[] = migrations
      .filter((m) => match(m.account_username, m.status, m.id, m.target_ip, serverById[m.source_server_id]?.name, serverById[m.target_server_id]?.name))
      .slice(0, q ? 8 : 5)
      .map((m) => ({ kind: 'migration', id: `m-${m.id}`, label: m.account_username, to: `/migrations/${m.id}`, migration: m }));
    const act = actions.filter((a) => a.kind === 'action' && match(a.label, a.keywords));
    return [...pg, ...srv, ...mig, ...act];
  }, [query, servers, migrations, serverById, pages, actions]);

  const groups = useMemo(
    () => [
      { title: t('palette.goTo'), items: items.filter((i) => i.kind === 'page') },
      { title: t('palette.servers'), items: items.filter((i) => i.kind === 'server') },
      { title: t('palette.migrations'), items: items.filter((i) => i.kind === 'migration') },
      { title: t('palette.actions'), items: items.filter((i) => i.kind === 'action') },
    ],
    [items, t],
  );

  const onSelect = (item: Item | null) => {
    if (!item) return;
    onClose();
    if (item.kind === 'action') item.run();
    else navigate(item.to);
  };

  return (
    <Transition.Root show={open} as={Fragment} afterLeave={() => setQuery('')}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-150" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] dark:bg-slate-950/70" aria-hidden="true" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto p-4 pt-[12vh]">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0 scale-[0.97] -translate-y-1"
            enterTo="opacity-100 scale-100 translate-y-0"
            leave="ease-in duration-100"
            leaveFrom="opacity-100 scale-100 translate-y-0"
            leaveTo="opacity-0 scale-[0.97] -translate-y-1"
          >
            <Dialog.Panel className={cn(surfaceClasses, 'mx-auto w-full max-w-xl transform overflow-hidden shadow-2xl shadow-slate-900/10 transition-all dark:shadow-black/50')}>
              <Combobox<Item | null> value={null} onChange={onSelect}>
                <div className="relative border-b border-slate-200 dark:border-white/[0.08]">
                  <MagnifyingGlassIcon className="pointer-events-none absolute start-4 top-3.5 h-5 w-5 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                  <Combobox.Input
                    autoFocus
                    className="h-12 w-full border-0 bg-transparent pe-12 ps-11 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500"
                    placeholder={t('palette.placeholder')}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label={t('a11y.search')}
                  />
                  <div className="absolute end-3 top-3.5 flex items-center gap-1">
                    {loading ? <Spinner size="sm" className="text-slate-400 dark:text-slate-500" /> : <Kbd>esc</Kbd>}
                  </div>
                </div>

                <Combobox.Options static className="max-h-[60vh] scroll-py-2 overflow-y-auto py-2">
                  {items.length === 0 && (
                    <div className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                      {loading ? t('palette.loading') : t('palette.noResults', { query })}
                    </div>
                  )}
                  {groups
                    .filter((g) => g.items.length > 0)
                    .map((g) => (
                      <div key={g.title} className="px-2 pb-1">
                        <div className="eyebrow px-2 pb-1 pt-2">{g.title}</div>
                        {g.items.map((item) => (
                          <Combobox.Option key={item.id} value={item} as={Fragment}>
                            {({ active }) => (
                              <li
                                className={cn(
                                  'flex cursor-pointer select-none items-center gap-3 rounded-lg px-2 py-2 text-sm',
                                  active ? 'bg-brand-50 text-brand-900 dark:bg-brand-500/15 dark:text-brand-100' : 'text-slate-700 dark:text-slate-200',
                                )}
                              >
                                {item.kind === 'page' || item.kind === 'action' ? (
                                  <>
                                    <item.icon className={cn('h-5 w-5 shrink-0', active ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500')} aria-hidden="true" />
                                    <span className="flex-1 truncate font-medium">{item.label}</span>
                                  </>
                                ) : item.kind === 'server' ? (
                                  <>
                                    <PanelMonogram panelType={item.server.panel_type} size="sm" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate font-medium">{item.label}</span>
                                      <Mono className="block text-xs text-slate-500 dark:text-slate-400">{item.server.host}</Mono>
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <ArrowsRightLeftIcon className={cn('h-5 w-5 shrink-0', active ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500')} aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                      <Mono className="block font-medium">{item.label}</Mono>
                                      <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                        <Mono>{shortId(item.migration.id)}</Mono>
                                        <span aria-hidden="true">·</span>
                                        <span className="truncate">{serverById[item.migration.source_server_id]?.name ?? '?'}</span>
                                        <ArrowRightIcon className="flip-rtl h-3 w-3 shrink-0" aria-hidden="true" />
                                        <span className="truncate">{serverById[item.migration.target_server_id]?.name ?? '?'}</span>
                                      </span>
                                    </span>
                                    <StatusBadge status={item.migration.status} size="sm" />
                                  </>
                                )}
                                {active && <Kbd className="shrink-0">↵</Kbd>}
                              </li>
                            )}
                          </Combobox.Option>
                        ))}
                      </div>
                    ))}
                </Combobox.Options>
              </Combobox>

              <div className="flex items-center gap-4 border-t border-slate-200 bg-slate-50 px-4 py-2 text-2xs text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400">
                <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> {t('palette.navigate')}</span>
                <span className="flex items-center gap-1"><Kbd>↵</Kbd> {t('palette.openHint')}</span>
                <span className="flex items-center gap-1"><Kbd>esc</Kbd> {t('palette.closeHint')}</span>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition.Root>
  );
}

export default CommandPalette;
