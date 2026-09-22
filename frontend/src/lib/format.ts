/**
 * Formatting helpers shared by pages and components. Dates, relative times, durations and
 * numbers follow the active language (he-IL / en-US) via `getLocale()` from ./i18n.
 */
import type { Migration, MigrationLog } from '../types';
import { getLang, getLocale, translate } from './i18n';

const EMPTY = '—';

function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 1536 -> "1.5 KB". Accepts numbers or numeric strings; returns "0 B" for empty/invalid input. */
export function formatBytes(bytes: number | string | null | undefined, decimals = 1): string {
  const n = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!n || !Number.isFinite(n) || n <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(k)), sizes.length - 1);
  const value = n / Math.pow(k, i);
  return `${parseFloat(value.toFixed(i === 0 ? 0 : decimals))} ${sizes[i]}`;
}

/** Locale-grouped integer/decimal: 8357 -> "8,357". */
export function formatNumber(n: number | null | undefined, opts?: Intl.NumberFormatOptions): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EMPTY;
  return new Intl.NumberFormat(getLocale(), opts).format(n);
}

/**
 * "3 minutes ago" / "לפני 3 דקות", "in 2 hours", "now" / "עכשיו". Falls back to a date for > 30 days.
 * Uses Intl.RelativeTimeFormat with numeric: 'auto' so yesterday/tomorrow read naturally.
 */
export function formatRelativeTime(input: string | number | Date | null | undefined, now: Date = new Date()): string {
  const date = toDate(input);
  if (!date) return EMPTY;

  const diffMs = date.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const sec = Math.round(abs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  const sign = diffMs < 0 ? -1 : 1;

  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  // Chrome's ICU appends a numeric hint to some Hebrew phrases ("לפני שעה (1)"); the phrase already carries the number.
  const rel = (value: number, unit: Intl.RelativeTimeFormatUnit) => {
    const text = rtf.format(value, unit);
    return getLang() === 'he' ? text.replace(/\s*\(\d+\)$/, '') : text;
  };
  if (sec < 45) return rel(0, 'second');
  if (min < 60) return rel(sign * min, 'minute');
  if (hr < 24) return rel(sign * hr, 'hour');
  if (day <= 30) return rel(sign * day, 'day');
  return formatDate(date);
}

/** Short absolute date+time in the active locale, e.g. "Sep 14, 2026, 00:04" / "14 בספט׳ 2026, 00:04". */
export function formatDate(input: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  const date = toDate(input);
  if (!date) return EMPTY;
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...opts,
  }).format(date);
}

/** Time only, 24h, e.g. "10:42:07" — used in log lines. */
export function formatTime(input: string | number | Date | null | undefined): string {
  const date = toDate(input);
  if (!date) return '';
  return new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
}

/** "3" + unit -> "3m" (en) / "3 דק׳" (he). */
function unit(n: number | string, key: 'time.h' | 'time.m' | 'time.s'): string {
  const u = translate(key);
  return getLang() === 'he' ? `${n} ${u}` : `${n}${u}`;
}

/**
 * Duration between two timestamps (or a number of milliseconds) as "1h 04m 12s" / "3m 02s" / "45s"
 * (Hebrew: "3 דק׳ 02 שנ׳"). If `end` is omitted the current time is used.
 */
export function formatDuration(
  start: string | number | Date | null | undefined,
  end?: string | number | Date | null,
): string {
  if (start === null || start === undefined) return EMPTY;
  let ms: number;
  if (typeof start === 'number' && end === undefined) {
    ms = start;
  } else {
    const s = toDate(start);
    const e = end ? toDate(end) : new Date();
    if (!s || !e) return EMPTY;
    ms = e.getTime() - s.getTime();
  }
  if (!Number.isFinite(ms) || ms < 0) return EMPTY;

  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  if (h > 0) return `${unit(h, 'time.h')} ${unit(pad(m), 'time.m')} ${unit(pad(s), 'time.s')}`;
  if (m > 0) return `${unit(m, 'time.m')} ${unit(pad(s), 'time.s')}`;
  return unit(s, 'time.s');
}

/** Compact duration for step rows: "0.8s" under 10s, "43s" under a minute, otherwise formatDuration. */
export function formatShortDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return EMPTY;
  if (ms < 10_000) return unit((ms / 1000).toFixed(1), 'time.s');
  if (ms < 60_000) return unit(Math.round(ms / 1000), 'time.s');
  return formatDuration(ms);
}

/**
 * The API serialises an unset timestamp as Go's zero time (0001-01-01T00:00:00Z).
 * Returns the input when it is a real date, otherwise `undefined`.
 */
export function realDate(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 ? undefined : input;
}

const FINISHED = new Set(['completed', 'failed', 'cancelled']);

/**
 * When a run really started and ended. The API sends `started_at` as the Go zero time, so the
 * window is derived from the first/last log line when the timestamps are missing.
 */
export function runWindow(m: Migration, logs: MigrationLog[]): { startedAt?: string; endedAt?: string; live: boolean } {
  const finished = FINISHED.has(m.status);
  const startedAt = realDate(m.started_at) ?? logs[0]?.created_at ?? realDate(m.created_at);
  const endedAt = realDate(m.completed_at) ?? (finished ? logs[logs.length - 1]?.created_at : undefined);
  return { startedAt, endedAt, live: !finished };
}

/** "608M", "3.2G", "324.8 MB" -> bytes. 0 for empty/unparsable input. */
export function parseSizeToBytes(size?: string | null): number {
  if (!size) return 0;
  const match = size.trim().match(/^([\d.]+)\s*([KMGT]?)B?$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const u = match[2].toUpperCase();
  const multipliers: Record<string, number> = { '': 1, K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024, T: 1024 * 1024 * 1024 * 1024 };
  return num * (multipliers[u] || 1);
}

/** A typed domain as a bare lowercase host: "https://www.Example.com/" -> "example.com" ("" stays ""). */
export function normalizeDomainInput(value: string): string {
  let s = value.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '');
  s = s.replace(/[/?#].*$/, '');
  s = s.replace(/^www\./, '');
  return s.replace(/^\.+|\.+$/g, '');
}

/** Platform-owned hostnames a site is only ever provisioned under (never the customer's real domain). */
export function isPlatformHostname(domain: string | null | undefined): boolean {
  return /\.cloudwaysapps\.com$/i.test(domain ?? '');
}

/** First 8 chars of an id (uuid-friendly) for compact display. */
export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return '';
  return id.length > length ? id.slice(0, length) : id;
}

/** Percentage helper clamped to 0..100. */
export function percent(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

/** English labels for panel types (fallback). Components use t(`panel.${type}`). */
export const PANEL_LABELS: Record<string, string> = {
  directadmin: 'DirectAdmin',
  enhance: 'Enhance',
  cpanel: 'cPanel',
  cloudpanel: 'CloudPanel',
  cloudways: 'Cloudways',
  ftp: 'FTP Only',
  wordpress: 'WordPress Only',
};

export function panelLabel(panelType: string | null | undefined): string {
  if (!panelType) return 'Unknown';
  return PANEL_LABELS[panelType] ?? panelType;
}
