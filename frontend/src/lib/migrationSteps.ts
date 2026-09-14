/**
 * Pure helpers that turn a migration's log into a step timeline and an inventory of what moved.
 * No React here; pages call these from useMemo.
 */
import type { Migration, MigrationLog } from '../types';
import { realDate } from './format';

export type StepPhase = 'export' | 'scan' | 'import';

/** The 13 wizard steps in run order (the scan step only when the option is on). */
export const MIGRATION_STEPS: { id: string; phase: StepPhase }[] = [
  { id: 'export_domains', phase: 'export' },
  { id: 'export_db', phase: 'export' },
  { id: 'export_emails', phase: 'export' },
  { id: 'export_cron', phase: 'export' },
  { id: 'export_files', phase: 'export' },
  { id: 'scan_malware', phase: 'scan' },
  { id: 'connect_node', phase: 'import' },
  { id: 'create_website', phase: 'import' },
  { id: 'import_files', phase: 'import' },
  { id: 'import_db', phase: 'import' },
  { id: 'import_emails', phase: 'import' },
  { id: 'fix_permissions', phase: 'import' },
  { id: 'cleanup', phase: 'import' },
];

/** Backend phrase -> step id (case-insensitive `includes`, first match wins). Same pairs as the wizard. */
export const STEP_MATCHERS: [string, string][] = [
  // Export phase
  ['Exporting domains', 'export_domains'],
  ['Exporting databases', 'export_db'],
  ['Exporting emails', 'export_emails'],
  ['Exporting cron', 'export_cron'],
  ['Exporting DNS', 'export_cron'],
  ['Exporting files', 'export_files'],
  ['Downloading files', 'export_files'],
  ['Export completed', 'export_files'],
  // Staging scan
  ['Scanning for malware', 'scan_malware'],
  ['Waiting for malware scan review', 'scan_malware'],
  ['Cleaning malware findings', 'scan_malware'],
  ['Malware scan reviewed', 'scan_malware'],
  // Import phase
  ['Starting import', 'connect_node'],
  ['Connecting to cluster node', 'connect_node'],
  ['Creating websites', 'create_website'],
  ['Creating website', 'create_website'],
  ['Uploading files', 'import_files'],
  ['Importing files', 'import_files'],
  ['Importing databases', 'import_db'],
  ['Registering WordPress', 'import_db'],
  ['WordPress cleanup', 'import_db'],
  ['Configuring PHP', 'import_db'],
  ['Importing email', 'import_emails'],
  ['Importing cron', 'import_emails'],
  ['Setting up SSL', 'import_emails'],
  ['Fixing file permissions', 'fix_permissions'],
  ['Fixing permissions', 'fix_permissions'],
  ['Cleaning up', 'cleanup'],
  ['Migration completed', 'cleanup'],
  ['Import completed', 'cleanup'],
];

const LOWER_MATCHERS: [string, string][] = STEP_MATCHERS.map(([p, id]) => [p.toLowerCase(), id]);

/** Step id a log line belongs to, or null when the line is not a step boundary. */
export function matchStepId(message: string): string | null {
  const m = message.toLowerCase();
  for (const [phrase, id] of LOWER_MATCHERS) if (m.includes(phrase)) return id;
  return null;
}

export type TimelineStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled' | 'skipped' | 'warning';

export interface TimelineItem {
  id: string;
  /** Optional display name; the Timeline component falls back to t(`steps.${id}.name`). */
  name?: string;
  phase: string;
  status: TimelineStatus;
  startedAt?: string | number;
  endedAt?: string | number;
  durationMs?: number;
  /** Id of the first log line of this step (for "jump to log"). */
  firstLogId?: string;
  lineCount: number;
  warnCount: number;
  error?: string;
  details?: string;
}

function ts(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = typeof v === 'number' ? v : new Date(v).getTime();
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Walk the log in order and build one item per step: when a line matches a later step the
 * previous step closes at that timestamp and the new one opens. Statuses follow the migration.
 */
export function deriveTimeline(
  logs: MigrationLog[],
  migration: Migration,
  opts?: { scan?: boolean; now?: number },
): TimelineItem[] {
  const scan = opts?.scan ?? !!migration.scan_requested;
  const now = opts?.now ?? Date.now();
  const steps = MIGRATION_STEPS.filter((s) => scan || s.id !== 'scan_malware');
  const indexOf = new Map(steps.map((s, i) => [s.id, i]));

  const items: TimelineItem[] = steps.map((s) => ({ id: s.id, phase: s.phase, status: 'pending', lineCount: 0, warnCount: 0 }));

  let current = -1;
  for (const log of logs) {
    const id = matchStepId(log.message);
    const idx = id ? indexOf.get(id) ?? -1 : -1;
    if (idx > current) {
      if (current >= 0) items[current].endedAt = log.created_at;
      current = idx;
      items[current].startedAt = log.created_at;
      items[current].firstLogId = log.id;
    }
    if (current >= 0) {
      items[current].lineCount++;
      if (log.level === 'warn' || (log.level as string) === 'warning') items[current].warnCount++;
    }
  }

  const status = migration.status;
  const lastLogAt = logs[logs.length - 1]?.created_at;
  const finishedAt = realDate(migration.completed_at) ?? lastLogAt;

  // A run that has started but not matched a step yet is on its first step.
  if (current < 0 && status !== 'pending' && (logs.length > 0 || status === 'running')) {
    current = 0;
    items[0].startedAt = logs[0]?.created_at ?? realDate(migration.started_at) ?? migration.created_at;
    items[0].firstLogId = logs[0]?.id;
  }

  items.forEach((it, i) => {
    if (i < current) it.status = 'completed';
    else if (i === current) {
      if (status === 'running') it.status = 'running';
      else if (status === 'completed') it.status = 'completed';
      else if (status === 'failed') {
        it.status = 'error';
        it.error = migration.error;
      } else if (status === 'cancelled') it.status = 'cancelled';
      else if (status === 'awaiting_review') it.status = it.id === 'scan_malware' ? 'warning' : 'running';
      else it.status = 'pending';
    } else it.status = status === 'completed' ? 'skipped' : 'pending';

    if (status === 'awaiting_review' && it.id === 'scan_malware') it.status = 'warning';

    if (i === current && it.endedAt === undefined) {
      if (status === 'running' || status === 'awaiting_review') it.endedAt = now;
      else if (finishedAt) it.endedAt = finishedAt;
    }
    const s = ts(it.startedAt);
    const e = ts(it.endedAt);
    if (s !== undefined && e !== undefined && e >= s) it.durationMs = e - s;
  });

  return items;
}

export interface Inventory {
  files?: number;
  /** Human size label from the upload line, e.g. "296MB". */
  bytesLabel?: string;
  uploadSeconds?: number;
  databases: number;
  tables: number;
  mailboxes: number;
  cronJobs: number;
  ssl: number;
  websites: string[];
}

const RX_UPLOADING = /Uploading (\d+) files for (\S+)/;
const RX_UPLOAD_DONE = /Upload for (\S+) done in (\d+)s: (\d+) files on node \(([\d.]+[KMGT]?)\)/;
const RX_DB_IMPORTED = /Database (\S+) imported on node: (\d+) tables/;
const RX_MAILBOX = /Mailbox (\S+) created/;
const RX_CRON = /(\d+) cron job\(s\) added/;
const RX_SSL = /SSL certificate installed for (\S+)/;
const RX_WEBSITE = /Website (\S+) created on server/;

function sizeToBytes(label: string): number {
  const m = label.match(/^([\d.]+)([KMGT]?)$/i);
  if (!m) return 0;
  const mult: Record<string, number> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
  return parseFloat(m[1]) * (mult[m[2].toUpperCase()] ?? 1);
}

function bytesLabel(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${parseFloat(v.toFixed(i === 0 ? 0 : 1))}${units[i]}`;
}

/** What actually moved, parsed from the log lines (with the "Export completed" metadata as fallback). */
export function parseInventory(logs: MigrationLog[]): Inventory {
  const inv: Inventory = { databases: 0, tables: 0, mailboxes: 0, cronJobs: 0, ssl: 0, websites: [] };
  let uploading = 0;
  let uploadedFiles = 0;
  let uploadBytes = 0;
  let uploadLabels: string[] = [];
  let uploadSeconds = 0;
  let exportMeta: Record<string, unknown> | null = null;

  for (const log of logs) {
    const msg = log.message;
    let m: RegExpMatchArray | null;
    if ((m = msg.match(RX_UPLOAD_DONE))) {
      uploadSeconds += Number(m[2]);
      uploadedFiles += Number(m[3]);
      uploadBytes += sizeToBytes(m[4]);
      uploadLabels.push(`${m[4]}B`);
    } else if ((m = msg.match(RX_UPLOADING))) {
      uploading += Number(m[1]);
    } else if ((m = msg.match(RX_DB_IMPORTED))) {
      inv.databases++;
      inv.tables += Number(m[2]);
    } else if (RX_MAILBOX.test(msg)) {
      inv.mailboxes++;
    } else if ((m = msg.match(RX_CRON))) {
      inv.cronJobs += Number(m[1]);
    } else if (RX_SSL.test(msg)) {
      inv.ssl++;
    } else if ((m = msg.match(RX_WEBSITE))) {
      if (!inv.websites.includes(m[1])) inv.websites.push(m[1]);
    } else if (msg.startsWith('Export completed') && log.metadata && typeof log.metadata === 'object') {
      exportMeta = log.metadata as Record<string, unknown>;
    }
  }

  if (uploadedFiles > 0) {
    inv.files = uploadedFiles;
    inv.bytesLabel = uploadLabels.length === 1 ? uploadLabels[0] : bytesLabel(uploadBytes);
    inv.uploadSeconds = uploadSeconds;
  } else if (uploading > 0) {
    inv.files = uploading;
  }

  if (exportMeta) {
    const num = (k: string) => (typeof exportMeta?.[k] === 'number' ? (exportMeta[k] as number) : 0);
    if (inv.databases === 0) inv.databases = num('databases');
    if (inv.mailboxes === 0) inv.mailboxes = num('emails');
    if (inv.cronJobs === 0) inv.cronJobs = num('cron_jobs');
  }

  uploadLabels = [];
  return inv;
}
