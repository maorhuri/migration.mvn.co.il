import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowTopRightOnSquareIcon, ExclamationTriangleIcon } from '@heroicons/react/16/solid';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/20/solid';
import { Button, Card, CardDescription, CardHeader, CardTitle, Checklist, ChecklistItem, CodeBlock, Figure, Mono, buttonClasses } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { formatDuration, formatNumber } from '../../lib/format';
import { parseInventory } from '../../lib/migrationSteps';
import type { Account, MigrationLog } from '../../types';

export interface MigrationCompleteProps {
  warningCount: number;
  warningLogs: MigrationLog[];
  targetNode: string;
  accounts: Account[];
  hostsEntry: string;
  /** Every log line of the run (all accounts): drives the "what moved" facts. */
  logs: MigrationLog[];
  /** Ids of the migrations that completed, in account order (links to the detail pages). */
  migrationIds: string[];
  /** Wall-clock length of the whole run (all accounts). */
  elapsedMs?: number;
  onStartNew: () => void;
  onViewAll: () => void;
}

type NextKey = 'hosts' | 'verify' | 'dns';
type NextState = Record<NextKey, boolean>;
const NEXT_DEFAULT: NextState = { hosts: false, verify: false, dns: false };
/** Step numbers the migration detail page stores under `mt-next:<id>` (1 hosts, 2 verify, 3 DNS). */
const NEXT_KEYS: NextKey[] = ['hosts', 'verify', 'dns'];
const storageKey = (id: string) => `mt-next:${id}`;

/** Ticks of the first migration of the run, in the detail page's format, so both screens agree. */
function readNext(ids: string[]): NextState {
  if (ids.length === 0) return NEXT_DEFAULT;
  try {
    const raw = localStorage.getItem(storageKey(ids[0]));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return NEXT_DEFAULT;
    return { hosts: parsed.includes(1), verify: parsed.includes(2), dns: parsed.includes(3) };
  } catch {
    return NEXT_DEFAULT;
  }
}

function writeNext(ids: string[], state: NextState) {
  const steps = NEXT_KEYS.map((k, i) => (state[k] ? i + 1 : 0)).filter((n) => n > 0);
  for (const id of ids) {
    try {
      localStorage.setItem(storageKey(id), JSON.stringify(steps));
    } catch {
      /* storage unavailable: the ticks simply do not persist */
    }
  }
}

/** A check (or an exclamation mark) that draws itself once. */
function DrawnMark({ warning }: { warning: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('mx-auto h-16 w-16', warning ? 'text-amber-500' : 'text-emerald-500')}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="28" pathLength={100} className="draw-path motion-safe:animate-draw" />
      {warning ? (
        <>
          <path d="M32 18v18" pathLength={100} className="draw-path motion-safe:animate-draw" style={{ animationDelay: '500ms' }} />
          <path d="M32 45v1" pathLength={100} className="draw-path motion-safe:animate-draw" style={{ animationDelay: '800ms' }} />
        </>
      ) : (
        <path d="M20 33l8 8 16-16" pathLength={100} className="draw-path motion-safe:animate-draw" style={{ animationDelay: '500ms' }} />
      )}
    </svg>
  );
}

/** Summary shown once every selected account has migrated, followed by the cutover checklist. */
export function MigrationComplete({ warningCount, warningLogs, targetNode, accounts, hostsEntry, logs, migrationIds, elapsedMs, onStartNew, onViewAll }: MigrationCompleteProps) {
  const t = useT();
  const hasWarnings = warningCount > 0;
  const inventory = useMemo(() => parseInventory(logs), [logs]);
  const targetIp = hostsEntry.split(' ')[0] || '';
  const domains = accounts.map((a) => a.domain).filter(Boolean);

  const idsKey = migrationIds.join(',');
  const [next, setNext] = useState<NextState>(() => readNext(migrationIds));
  useEffect(() => {
    setNext(readNext(idsKey ? idsKey.split(',') : []));
  }, [idsKey]);
  const toggle = (key: NextKey) =>
    setNext((prev) => {
      const value = { ...prev, [key]: !prev[key] };
      writeNext(migrationIds, value);
      return value;
    });
  const doneCount = (['hosts', 'verify', 'dns'] as NextKey[]).filter((k) => next[k]).length;

  const hasDuration = elapsedMs !== undefined && elapsedMs > 0;
  const single = accounts.length === 1 && !!accounts[0].domain;
  const what = single ? <Mono className="text-slate-900 dark:text-slate-100">{accounts[0].domain}</Mono> : t('units.accounts', { count: accounts.length });
  const subtitleKey = targetNode ? (single ? 'newmigration.complete.subtitle' : 'newmigration.complete.subtitleMany') : single ? 'newmigration.complete.subtitleNoNode' : 'newmigration.complete.subtitleNoNodeMany';

  return (
    <div className="space-y-6">
      <Card className="text-center motion-safe:animate-rise" aria-live="polite">
        <DrawnMark warning={hasWarnings} />
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">{hasWarnings ? t('newmigration.complete.titleWarnings') : t('newmigration.complete.title')}</h2>
        <p className="mx-auto mt-2 max-w-xl text-balance text-sm text-slate-700 dark:text-slate-300">
          {t.rich(subtitleKey, { what, node: <Mono className="font-medium text-slate-900 dark:text-slate-100">{targetNode}</Mono> })}
        </p>
        <p className="mx-auto mt-1 max-w-xl text-balance text-xs text-slate-500 dark:text-slate-400">{hasWarnings ? t('newmigration.complete.hintWarnings') : t('newmigration.complete.hint')}</p>

        <dl className={cn('mx-auto mt-6 grid max-w-3xl grid-cols-2 gap-4 border-t border-slate-100 pt-6 dark:border-white/[0.06]', hasDuration ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
          <Figure label={t('newmigration.complete.facts.accounts')} value={accounts.length} countUp />
          <Figure label={t('newmigration.complete.facts.files')} value={inventory.files !== undefined ? formatNumber(inventory.files) : '—'} mono />
          <Figure label={t('newmigration.complete.facts.transferred')} value={inventory.bytesLabel ?? '—'} mono />
          {hasDuration && <Figure label={t('time.duration')} value={formatDuration(elapsedMs)} />}
          <Figure label={t('newmigration.complete.facts.warnings')} value={warningCount} countUp tone={hasWarnings ? 'warning' : 'neutral'} />
        </dl>
      </Card>

      {warningLogs.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-500/30 dark:bg-amber-500/10 sm:p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-amber-900 dark:text-amber-100">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            {t('newmigration.complete.warnings.title')}
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm text-amber-800 dark:text-amber-200">
            {warningLogs.map((log) => (
              <li key={log.id} className="flex gap-2">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                <Mono className="min-w-0 whitespace-normal break-words text-[13px]">{log.message}</Mono>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('newmigration.complete.next.title')}</CardTitle>
          <CardDescription>{t('newmigration.complete.next.description')}</CardDescription>
        </CardHeader>
        <Checklist progress={{ done: doneCount, total: 4 }}>
          <ChecklistItem
            index={1}
            title={t('newmigration.complete.hosts.title')}
            description={t('newmigration.complete.hosts.description')}
            done={next.hosts}
            onToggle={() => toggle('hosts')}
            toggleLabel={t('newmigration.complete.hosts.markDone')}
          >
            <CodeBlock title="/etc/hosts" code={hostsEntry} copiedMessage={t('newmigration.complete.hosts.copied')} />
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span>{t('newmigration.complete.hosts.windows')}</span>
                <Mono className="text-slate-700 dark:text-slate-300">C:\Windows\System32\drivers\etc\hosts</Mono>
              </span>
              <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span>{t('newmigration.complete.hosts.unix')}</span>
                <Mono className="text-slate-700 dark:text-slate-300">/etc/hosts</Mono>
              </span>
            </p>
          </ChecklistItem>

          <ChecklistItem
            index={2}
            title={t('newmigration.complete.verify.title')}
            description={t('newmigration.complete.verify.description')}
            done={next.verify}
            onToggle={() => toggle('verify')}
            toggleLabel={t('newmigration.complete.verify.markDone')}
            action={
              domains.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {domains.map((domain) => (
                    <a
                      key={domain}
                      href={`https://${domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('newmigration.complete.verify.openAria', { domain })}
                      className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                    >
                      <Mono>{domain}</Mono>
                      <ArrowTopRightOnSquareIcon className="flip-rtl text-slate-400 dark:text-slate-500" aria-hidden="true" />
                    </a>
                  ))}
                </div>
              ) : undefined
            }
          />

          <ChecklistItem
            index={3}
            title={t('newmigration.complete.dns.title')}
            description={t.rich('newmigration.complete.dns.description', { ip: targetIp ? <CodeBlock inline code={targetIp} className="align-middle" /> : '—' })}
            done={next.dns}
            onToggle={() => toggle('dns')}
            toggleLabel={t('newmigration.complete.dns.markDone')}
          />

          <ChecklistItem
            index={4}
            title={t('newmigration.complete.suspend.title')}
            description={t('newmigration.complete.suspend.description')}
            done={false}
            action={
              migrationIds.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {accounts.map((account, i) =>
                    migrationIds[i] ? (
                      <Link key={migrationIds[i]} to={`/migrations/${migrationIds[i]}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                        <span>{t('newmigration.complete.suspend.open')}</span>
                        <Mono>{account.domain || account.username}</Mono>
                      </Link>
                    ) : null,
                  )}
                </div>
              ) : undefined
            }
          />
        </Checklist>
      </Card>

      <Card flush>
        <CardHeader divided>
          <CardTitle>{t('newmigration.complete.migrated.title')}</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
          {accounts.map((account) => (
            <li key={account.username} className="flex items-center gap-3 px-5 py-2.5 sm:px-6">
              <CheckCircleSolid className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
              <Mono className="min-w-0 text-sm font-medium text-slate-900 dark:text-slate-100">{account.domain || account.username}</Mono>
              <Mono className="min-w-0 text-xs text-slate-500 dark:text-slate-400">{account.username}</Mono>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onStartNew}>
          {t('newmigration.complete.startNew')}
        </Button>
        <Button variant="primary" onClick={onViewAll}>
          {t('newmigration.complete.viewAll')}
        </Button>
      </div>
    </div>
  );
}

export default MigrationComplete;
