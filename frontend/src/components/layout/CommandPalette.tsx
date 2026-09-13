import { Fragment, useEffect, useMemo, useState } from 'react';
import { Combobox, Dialog, Transition } from '@headlessui/react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { ArrowsRightLeftIcon, KeyIcon, PlusIcon, ServerStackIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { getMigrations, getServers } from '../../api/client';
import type { Migration, Server } from '../../types';
import { cn } from '../../lib/cn';
import { shortId } from '../../lib/format';
import { Kbd } from '../ui/Kbd';
import { PanelBadge } from '../ui/PanelBadge';
import { StatusBadge } from '../ui/StatusBadge';
import { Spinner } from '../ui/Spinner';

type Item =
  | { kind: 'page'; id: string; label: string; to: string; icon: typeof ServerStackIcon; keywords?: string }
  | { kind: 'server'; id: string; label: string; to: string; server: Server }
  | { kind: 'migration'; id: string; label: string; to: string; migration: Migration };

const PAGES: Item[] = [
  { kind: 'page', id: 'p-new', label: 'New migration', to: '/migrations/new', icon: PlusIcon, keywords: 'create start wizard' },
  { kind: 'page', id: 'p-dash', label: 'Dashboard', to: '/', icon: Squares2X2Icon, keywords: 'home overview' },
  { kind: 'page', id: 'p-servers', label: 'Servers', to: '/servers', icon: ServerStackIcon },
  { kind: 'page', id: 'p-migrations', label: 'Migrations', to: '/migrations', icon: ArrowsRightLeftIcon },
  { kind: 'page', id: 'p-keys', label: 'SSH Keys', to: '/ssh-keys', icon: KeyIcon },
];

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Cmd+K / Ctrl+K palette. Loads servers and migrations when opened, filters locally,
 * navigates on select. The shortcut listener lives in AppShell.
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
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

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (...parts: (string | undefined)[]) => !q || parts.some((p) => p?.toLowerCase().includes(q));

    const pages = PAGES.filter((p) => p.kind === 'page' && match(p.label, p.keywords));
    const srv: Item[] = servers
      .filter((s) => match(s.name, s.host, s.panel_type, s.id))
      .slice(0, q ? 8 : 5)
      .map((s) => ({ kind: 'server', id: `s-${s.id}`, label: s.name, to: `/servers/${s.id}`, server: s }));
    const mig: Item[] = migrations
      .filter((m) => match(m.account_username, m.status, m.id, m.target_ip, serverById[m.source_server_id]?.name, serverById[m.target_server_id]?.name))
      .slice(0, q ? 8 : 5)
      .map((m) => ({ kind: 'migration', id: `m-${m.id}`, label: m.account_username, to: `/migrations/${m.id}`, migration: m }));
    return [...pages, ...srv, ...mig];
  }, [query, servers, migrations, serverById]);

  const groups = useMemo(
    () => [
      { title: 'Go to', items: items.filter((i) => i.kind === 'page') },
      { title: 'Servers', items: items.filter((i) => i.kind === 'server') },
      { title: 'Migrations', items: items.filter((i) => i.kind === 'migration') },
    ],
    [items],
  );

  const onSelect = (item: Item | null) => {
    if (!item) return;
    onClose();
    navigate(item.to);
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
            <Dialog.Panel className="mx-auto w-full max-w-xl transform overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 transition-all dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40">
              <Combobox<Item | null> value={null} onChange={onSelect}>
                <div className="relative border-b border-slate-200 dark:border-slate-800">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                  <Combobox.Input
                    autoFocus
                    className="h-12 w-full border-0 bg-transparent pl-11 pr-12 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500"
                    placeholder="Search servers, migrations, pages…"
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search"
                  />
                  <div className="absolute right-3 top-3.5 flex items-center gap-1">
                    {loading ? <Spinner size="sm" className="text-slate-400" /> : <Kbd>esc</Kbd>}
                  </div>
                </div>

                <Combobox.Options static className="max-h-[60vh] scroll-py-2 overflow-y-auto py-2">
                  {items.length === 0 && (
                    <div className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                      {loading ? 'Loading…' : `No results for “${query}”`}
                    </div>
                  )}
                  {groups
                    .filter((g) => g.items.length > 0)
                    .map((g) => (
                      <div key={g.title} className="px-2 pb-1">
                        <div className="px-2 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{g.title}</div>
                        {g.items.map((item) => (
                          <Combobox.Option key={item.id} value={item} as={Fragment}>
                            {({ active }) => (
                              <li
                                className={cn(
                                  'flex cursor-pointer select-none items-center gap-3 rounded-lg px-2 py-2 text-sm',
                                  active ? 'bg-indigo-50 text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-200',
                                )}
                              >
                                {item.kind === 'page' ? (
                                  <>
                                    <item.icon className="h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                                    <span className="flex-1 truncate font-medium">{item.label}</span>
                                  </>
                                ) : item.kind === 'server' ? (
                                  <>
                                    <ServerStackIcon className="h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate font-medium">{item.label}</span>
                                      <span className="block truncate font-mono text-xs text-slate-500 dark:text-slate-400">{item.server.host}</span>
                                    </span>
                                    <PanelBadge panelType={item.server.panel_type} size="sm" />
                                  </>
                                ) : (
                                  <>
                                    <ArrowsRightLeftIcon className="h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate font-medium">{item.label}</span>
                                      <span className="block truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                                        {shortId(item.migration.id)} · {serverById[item.migration.source_server_id]?.name ?? '?'} → {serverById[item.migration.target_server_id]?.name ?? '?'}
                                      </span>
                                    </span>
                                    <StatusBadge status={item.migration.status} size="sm" />
                                  </>
                                )}
                              </li>
                            )}
                          </Combobox.Option>
                        ))}
                      </div>
                    ))}
                </Combobox.Options>
              </Combobox>

              <div className="flex items-center gap-4 border-t border-slate-200 bg-slate-50 px-4 py-2 text-2xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
                <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
                <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition.Root>
  );
}

export default CommandPalette;
