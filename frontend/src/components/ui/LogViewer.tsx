import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownIcon } from '@heroicons/react/16/solid';
import { cn } from '../../lib/cn';
import { formatTime } from '../../lib/format';
import { EmptyState } from './EmptyState';
import { Tabs } from './Tabs';
import { DocumentTextIcon } from '@heroicons/react/24/outline';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | (string & {});

export interface LogItem {
  id: string;
  level: LogLevel;
  message: string;
  created_at: string;
}

export interface LogViewerProps {
  items: LogItem[];
  /** Auto-scroll to the newest line when new items arrive (default true). */
  follow?: boolean;
  /** Show level filter chips (all / info / warn / error). */
  filterable?: boolean;
  /** Fixed height of the console (default 24rem). */
  height?: string;
  /** Show a "live" indicator in the header. */
  live?: boolean;
  /** Header title. */
  title?: string;
  emptyMessage?: string;
  className?: string;
}

const levelClasses: Record<string, { text: string; badge: string }> = {
  info: { text: 'text-slate-200', badge: 'text-sky-400' },
  debug: { text: 'text-slate-400', badge: 'text-slate-500' },
  warn: { text: 'text-amber-200', badge: 'text-amber-400' },
  warning: { text: 'text-amber-200', badge: 'text-amber-400' },
  error: { text: 'text-rose-200', badge: 'text-rose-400' },
};

type Filter = 'all' | 'info' | 'warn' | 'error';

/**
 * Scrolling console for migration logs. Dark in both themes. Auto-follows new lines
 * until the user scrolls up; a "Jump to latest" button re-enables following.
 */
export function LogViewer({ items, follow = true, filterable = true, height = '24rem', live, title = 'Log', emptyMessage = 'No log lines yet', className }: LogViewerProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [following, setFollowing] = useState(follow);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const counts = useMemo(() => {
    const c: Record<'info' | 'warn' | 'error', number> = { info: 0, warn: 0, error: 0 };
    for (const it of items) {
      const lv = it.level === 'warning' ? 'warn' : it.level;
      if (lv === 'info' || lv === 'warn' || lv === 'error') c[lv as 'info' | 'warn' | 'error']++;
    }
    return c;
  }, [items]);

  const visible = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((it) => (it.level === 'warning' ? 'warn' : it.level) === filter);
  }, [items, filter]);

  useEffect(() => {
    if (!following) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, following]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== following) setFollowing(atBottom);
  };

  const jumpToLatest = () => {
    setFollowing(true);
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950 shadow-sm dark:border-slate-700', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
          {live && (
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          )}
          <span>{title}</span>
          <span className="font-mono text-2xs text-slate-500">{visible.length} lines</span>
        </div>
        {filterable && (
          <Tabs<Filter>
            size="sm"
            variant="pills"
            value={filter}
            onChange={setFilter}
            className="bg-slate-900 [&_button[aria-selected=true]]:bg-slate-800 [&_button[aria-selected=true]]:text-slate-100 [&_button]:text-slate-400"
            tabs={[
              { id: 'all', label: 'All' },
              { id: 'info', label: 'Info', count: counts.info },
              { id: 'warn', label: 'Warn', count: counts.warn },
              { id: 'error', label: 'Error', count: counts.error },
            ]}
          />
        )}
      </div>

      <div className="relative">
        <div ref={scrollRef} onScroll={onScroll} className="overflow-y-auto font-mono text-xs leading-5" style={{ height }} role="log" aria-live="polite">
          {visible.length === 0 ? (
            <EmptyState size="sm" icon={DocumentTextIcon} title={emptyMessage} className="text-slate-400 [&_h3]:text-slate-300 [&_div]:border-slate-800 [&_div]:bg-slate-900" />
          ) : (
            <ol className="py-1">
              {visible.map((it) => {
                const lv = levelClasses[it.level] ?? levelClasses.info;
                return (
                  <li key={it.id} className="flex gap-3 px-3 py-0.5 hover:bg-white/[0.03]">
                    <span className="shrink-0 tabular text-slate-500">{formatTime(it.created_at)}</span>
                    <span className={cn('w-12 shrink-0 uppercase', lv.badge)}>{it.level === 'warning' ? 'warn' : it.level}</span>
                    <span className={cn('min-w-0 whitespace-pre-wrap break-words', lv.text)}>{it.message}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {!following && visible.length > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-100 shadow-pop ring-1 ring-slate-700 transition-colors hover:bg-slate-700"
          >
            <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}

export default LogViewer;
