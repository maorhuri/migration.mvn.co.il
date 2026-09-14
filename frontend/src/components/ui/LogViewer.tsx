import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownIcon } from '@heroicons/react/16/solid';
import { cn } from '../../lib/cn';
import { formatTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { EmptyState } from './EmptyState';
import { Tabs } from './Tabs';

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
  /** The run is live: green chip in the header and a blinking cursor after the last line. */
  live?: boolean;
  /** Header title (defaults to t('log.title')). */
  title?: string;
  /** Empty message (defaults to t('log.empty')). */
  emptyMessage?: string;
  /** Scroll to this line id, center it, and flash it (clears the level filter if needed). */
  jumpToId?: string | null;
  /** Return a section title for lines that start a section (step boundaries); null otherwise. */
  sectionFor?: (item: LogItem) => string | null;
  /** Blinking cursor after the last line (defaults to `live`). */
  cursor?: boolean;
  className?: string;
}

const levelClasses: Record<string, { text: string; badge: string; border: string }> = {
  info: { text: 'text-slate-200', badge: 'text-sky-400', border: 'border-sky-500/60' },
  debug: { text: 'text-slate-400', badge: 'text-slate-500', border: 'border-slate-600' },
  warn: { text: 'text-amber-200', badge: 'text-amber-400', border: 'border-amber-500' },
  warning: { text: 'text-amber-200', badge: 'text-amber-400', border: 'border-amber-500' },
  error: { text: 'text-rose-200', badge: 'text-rose-400', border: 'border-rose-500' },
};

type Filter = 'all' | 'info' | 'warn' | 'error';

const norm = (level: string) => (level === 'warning' ? 'warn' : level);

/** Section titles are translated: Hebrew ones drop the uppercase tracking and read in the UI face. */
const HEBREW = /[\u0590-\u05FF]/;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scrolling console for migration logs. Dark and left-to-right in both themes and both languages.
 * Auto-follows new lines until the user scrolls up; "Jump to latest" re-enables following.
 * New lines fade in; `jumpToId` centers and flashes a line (handled in a layout effect the moment the
 * id changes, and the viewer's own scrolls never count as the user scrolling away); `sectionFor` adds
 * section headers. To jump to the same line twice, set `jumpToId` to null in between.
 */
export function LogViewer({
  items,
  follow = true,
  filterable = true,
  height = '24rem',
  live,
  title,
  emptyMessage,
  jumpToId,
  sectionFor,
  cursor,
  className,
}: LogViewerProps) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const [following, setFollowing] = useState(follow);
  const [flashId, setFlashId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const firstRenderRef = useRef(true);
  const pendingJumpRef = useRef<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  // Target of a scroll the viewer started itself (jump, "latest"): scroll events until it lands are not the user's.
  const programmaticRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);

  const scrollProgrammatically = (container: HTMLDivElement, top: number) => {
    const target = Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight));
    programmaticRef.current = target;
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
    container.scrollTo({ top: target, behavior });
    // A smooth scroll that cannot reach its target (content shrank) must not mute the handler forever.
    settleTimerRef.current = window.setTimeout(() => {
      programmaticRef.current = null;
    }, behavior === 'auto' ? 80 : 1200);
  };

  const counts = useMemo(() => {
    const c: Record<'info' | 'warn' | 'error', number> = { info: 0, warn: 0, error: 0 };
    for (const it of items) {
      const lv = norm(it.level);
      if (lv === 'info' || lv === 'warn' || lv === 'error') c[lv as 'info' | 'warn' | 'error']++;
    }
    return c;
  }, [items]);

  const visible = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((it) => norm(it.level) === filter);
  }, [items, filter]);

  // Lines not seen in the previous render mount with a short fade.
  const isNew = (id: string) => !firstRenderRef.current && !seenRef.current.has(id);
  useEffect(() => {
    for (const it of items) seenRef.current.add(it.id);
    firstRenderRef.current = false;
  }, [items]);

  useEffect(() => {
    // A jump in flight owns the scroll position; following resumes only from "Jump to latest".
    if (!following || programmaticRef.current !== null) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, following]);

  // Jump request, recorded before layout so the effect below acts in the same commit:
  // clear the level filter if the line is hidden, then scroll + flash once it is rendered.
  useLayoutEffect(() => {
    if (!jumpToId) return;
    pendingJumpRef.current = jumpToId;
    const item = items.find((i) => i.id === jumpToId);
    if (item && filter !== 'all' && norm(item.level) !== filter) setFilter('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToId]);

  useLayoutEffect(() => {
    const id = pendingJumpRef.current;
    const container = scrollRef.current;
    if (!id || !container) return;
    const el = container.querySelector<HTMLElement>(`[data-log-id="${CSS.escape(id)}"]`);
    if (!el) return;
    pendingJumpRef.current = null;
    setFollowing(false);
    scrollProgrammatically(container, el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2);
    setFlashId(id);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashId(null), 1600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, jumpToId]);

  useEffect(
    () => () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    },
    [],
  );

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (programmaticRef.current !== null) {
      // Our own scroll is still travelling: it landed when it reaches the target.
      if (Math.abs(el.scrollTop - programmaticRef.current) < 2) programmaticRef.current = null;
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== following) setFollowing(atBottom);
  };

  const jumpToLatest = () => {
    setFollowing(true);
    const el = scrollRef.current;
    if (el) scrollProgrammatically(el, el.scrollHeight);
  };

  const showCursor = cursor ?? !!live;

  return (
    <div dir="ltr" className={cn('flex flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950 text-left dark:border-white/[0.1]', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-300">
          <span className="truncate">{title ?? t('log.title')}</span>
          <span className="font-mono text-2xs text-slate-500">{t('log.lines', { count: visible.length })}</span>
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              {t('log.live')}
            </span>
          )}
          {following && visible.length > 0 && <span className="hidden text-2xs text-slate-500 sm:inline">{t('log.following')}</span>}
        </div>
        {filterable && (
          <Tabs<Filter>
            size="sm"
            variant="pills"
            value={filter}
            onChange={setFilter}
            className="bg-slate-900 [&_button[aria-selected=true]]:bg-slate-800 [&_button[aria-selected=true]]:text-slate-100 [&_button]:text-slate-400"
            tabs={[
              { id: 'all', label: t('log.all') },
              { id: 'info', label: t('log.info'), count: counts.info },
              { id: 'warn', label: <span className={counts.warn > 0 ? 'text-amber-300' : undefined}>{t('log.warn')}</span>, count: counts.warn },
              { id: 'error', label: <span className={counts.error > 0 ? 'text-rose-300' : undefined}>{t('log.error')}</span>, count: counts.error },
            ]}
          />
        )}
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="relative overflow-y-auto scroll-smooth font-mono text-xs leading-5 motion-reduce:scroll-auto"
          style={{ height }}
          role="log"
          aria-live="polite"
        >
          {visible.length === 0 ? (
            <EmptyState
              size="sm"
              illustration="log"
              title={emptyMessage ?? t('log.empty')}
              className="h-full justify-center font-sans text-slate-400 [&_h3]:text-slate-300 [&_svg]:text-slate-700 [&_.dot-grid]:opacity-30"
            />
          ) : (
            <ol className="py-1">
              {visible.map((it) => {
                const lv = levelClasses[it.level] ?? levelClasses.info;
                const section = sectionFor?.(it);
                return (
                  <li key={it.id} className="contents">
                    {section && (
                      <div className="mt-2 flex items-center gap-2 border-t border-slate-800/80 px-3 pt-2">
                        <span className={cn('text-2xs font-semibold text-brand-300', HEBREW.test(section) ? 'font-sans' : 'uppercase tracking-wider')}>{section}</span>
                        <span className="tabular text-2xs text-slate-600">{formatTime(it.created_at)}</span>
                      </div>
                    )}
                    <div
                      id={`log-${it.id}`}
                      data-log-id={it.id}
                      className={cn(
                        'flex gap-3 px-3 py-0.5 hover:bg-white/[0.03]',
                        isNew(it.id) && 'motion-safe:animate-log-in',
                        flashId === it.id && 'animate-log-flash',
                      )}
                    >
                      <span className="shrink-0 tabular text-slate-500">{formatTime(it.created_at)}</span>
                      <span className={cn('w-10 shrink-0 border-s-2 ps-2 text-2xs uppercase leading-5', lv.badge, lv.border)}>{norm(it.level)}</span>
                      <span className={cn('min-w-0 whitespace-pre-wrap break-words', lv.text)}>{it.message}</span>
                    </div>
                  </li>
                );
              })}
              {showCursor && (
                <li aria-hidden="true" className="flex gap-3 px-3 py-0.5">
                  <span className="inline-block h-3.5 w-[7px] translate-y-[3px] bg-emerald-400 motion-safe:animate-cursor-blink" />
                </li>
              )}
            </ol>
          )}
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-slate-950 to-transparent" />
        {!following && visible.length > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-100 shadow-pop ring-1 ring-slate-700 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <ArrowDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {t('log.jumpToLatest')}
          </button>
        )}
      </div>
    </div>
  );
}

export default LogViewer;
