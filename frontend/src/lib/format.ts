/**
 * Formatting helpers shared by pages and components.
 */

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

/** "3 minutes ago", "in 2 hours", "just now". Falls back to a date for > 30 days. */
export function formatRelativeTime(input: string | number | Date | null | undefined, now: Date = new Date()): string {
  if (!input) return '—';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = date.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const sec = Math.round(abs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);

  if (sec < 45) return 'just now';

  let label: string;
  if (min < 60) label = `${min} minute${min === 1 ? '' : 's'}`;
  else if (hr < 24) label = `${hr} hour${hr === 1 ? '' : 's'}`;
  else if (day <= 30) label = `${day} day${day === 1 ? '' : 's'}`;
  else return formatDate(date);

  return diffMs < 0 ? `${label} ago` : `in ${label}`;
}

/** Short absolute date+time in the user's locale, e.g. "Sep 13, 2026, 10:42". */
export function formatDate(input: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!input) return '—';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...opts,
  });
}

/** Time only, e.g. "10:42:07" — used in log lines. */
export function formatTime(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour12: false });
}

/**
 * Duration between two timestamps (or a number of milliseconds) as "1h 04m 12s" / "45s" / "3m 02s".
 * If `end` is omitted the current time is used.
 */
export function formatDuration(
  start: string | number | Date | null | undefined,
  end?: string | number | Date | null,
): string {
  if (start === null || start === undefined) return '—';
  let ms: number;
  if (typeof start === 'number' && end === undefined) {
    ms = start;
  } else {
    const s = start instanceof Date ? start : new Date(start);
    const e = end ? (end instanceof Date ? end : new Date(end)) : new Date();
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '—';
    ms = e.getTime() - s.getTime();
  }
  if (!Number.isFinite(ms) || ms < 0) return '—';

  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
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

/** Human labels for panel types. */
export const PANEL_LABELS: Record<string, string> = {
  directadmin: 'DirectAdmin',
  enhance: 'Enhance',
  cpanel: 'cPanel',
  cloudpanel: 'CloudPanel',
  ftp: 'FTP Only',
  wordpress: 'WordPress Only',
};

export function panelLabel(panelType: string | null | undefined): string {
  if (!panelType) return 'Unknown';
  return PANEL_LABELS[panelType] ?? panelType;
}
