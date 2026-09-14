import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowTopRightOnSquareIcon, PauseCircleIcon, PlayCircleIcon } from '@heroicons/react/20/solid';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, Checklist, ChecklistItem, CodeBlock, Mono, buttonClasses } from '../ui';
import { formatDate, formatRelativeTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { Migration } from '../../types';

export interface NextStepsCardProps {
  migration: Migration;
  /** Source server name for the suspend button. */
  sourceName?: string;
  /** "<ip> <domain> <domain>" line for /etc/hosts, or null when the export has no domains. */
  hostsEntry: string | null;
  domains: string[];
  /** Opens the existing suspend / unsuspend confirm dialogs. */
  onSuspend: () => void;
  onUnsuspend: () => void;
  className?: string;
  style?: CSSProperties;
}

const WINDOWS_HOSTS = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
const MANUAL_STEPS = [1, 2, 3] as const;
const TOTAL = 4;

const storageKey = (id: string) => `mt-next:${id}`;

function readDone(id: string): number[] {
  try {
    const raw = localStorage.getItem(storageKey(id));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

function writeDone(id: string, steps: number[]) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(steps));
  } catch {
    /* storage unavailable: the ticks simply do not persist */
  }
}

function DomainList({ domains }: { domains: string[] }) {
  if (domains.length === 0) return <Mono>—</Mono>;
  return (
    <>
      {domains.map((d, i) => (
        <Fragment key={d}>
          {i > 0 && ', '}
          <Mono>{d}</Mono>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Cutover checklist for a completed migration: preview through /etc/hosts, check in the browser,
 * switch DNS, suspend the source. Steps 1-3 are ticked by hand and remembered per migration in
 * localStorage; step 4 is derived from `source_suspended_at` and opens the existing dialogs.
 */
export function NextStepsCard({ migration, sourceName, hostsEntry, domains, onSuspend, onUnsuspend, className, style }: NextStepsCardProps) {
  const t = useT();
  const [manual, setManual] = useState<number[]>(() => readDone(migration.id));
  useEffect(() => {
    setManual(readDone(migration.id));
  }, [migration.id]);

  const toggle = (step: number) =>
    setManual((prev) => {
      const next = prev.includes(step) ? prev.filter((s) => s !== step) : [...prev, step].sort();
      writeDone(migration.id, next);
      return next;
    });

  const suspended = !!migration.source_suspended_at;
  const isDone = (step: number) => manual.includes(step);
  const done = MANUAL_STEPS.filter(isDone).length + (suspended ? 1 : 0);
  const allDone = done === TOTAL;

  const dnsDomains = domains.length > 0 ? domains : migration.export_data?.account?.domain ? [migration.export_data.account.domain] : [];
  const server: ReactNode = sourceName ? <Mono>{sourceName}</Mono> : t('migrationdetail.confirm.sourceServer');

  const hostsTitle = t('migrationdetail.next.hosts.title');
  const verifyTitle = t('migrationdetail.next.verify.title');
  const dnsTitle = t('migrationdetail.next.dns.title');

  return (
    <Card edge={allDone ? 'success' : undefined} className={className} style={style}>
      <CardHeader
        actions={
          <Badge tone={allDone ? 'success' : 'neutral'} className="tabular">
            {t('migrationdetail.next.progress', { done, total: TOTAL })}
          </Badge>
        }
      >
        <CardTitle>{t('migrationdetail.next.title')}</CardTitle>
        <CardDescription>{t('migrationdetail.next.description')}</CardDescription>
      </CardHeader>

      <Checklist progress={{ done, total: TOTAL }}>
        <ChecklistItem
          index={1}
          title={hostsTitle}
          done={isDone(1)}
          onToggle={() => toggle(1)}
          toggleLabel={t('migrationdetail.next.markDone', { step: hostsTitle })}
          description={
            hostsEntry
              ? t.rich('migrationdetail.next.hosts.description', { win: <Mono>{WINDOWS_HOSTS}</Mono> })
              : t('migrationdetail.next.hosts.missing')
          }
        >
          {hostsEntry && <CodeBlock title="/etc/hosts" code={hostsEntry} />}
        </ChecklistItem>

        <ChecklistItem
          index={2}
          title={verifyTitle}
          done={isDone(2)}
          onToggle={() => toggle(2)}
          toggleLabel={t('migrationdetail.next.markDone', { step: verifyTitle })}
          description={t('migrationdetail.next.verify.description')}
        >
          {domains.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {domains.map((d) => (
                <a
                  key={d}
                  href={`https://${d}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('migrationdetail.next.verify.open', { domain: d })}
                  className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                >
                  <Mono>{d}</Mono>
                  <ArrowTopRightOnSquareIcon className="flip-rtl text-slate-400 dark:text-slate-500" aria-hidden="true" />
                </a>
              ))}
            </div>
          )}
        </ChecklistItem>

        <ChecklistItem
          index={3}
          title={dnsTitle}
          done={isDone(3)}
          onToggle={() => toggle(3)}
          toggleLabel={t('migrationdetail.next.markDone', { step: dnsTitle })}
          description={
            <>
              <span className="leading-6">
                {t.rich('migrationdetail.next.dns.description', {
                  domains: <DomainList domains={dnsDomains} />,
                  ip: migration.target_ip ? <CodeBlock inline code={migration.target_ip} /> : <Mono>—</Mono>,
                })}
              </span>
              <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{t('migrationdetail.next.dns.hint')}</span>
            </>
          }
        />

        <ChecklistItem
          index={4}
          title={t('migrationdetail.next.suspend.title')}
          done={suspended}
          description={
            suspended ? (
              <span title={formatDate(migration.source_suspended_at)}>
                {t('migrationdetail.next.suspend.done', { when: formatRelativeTime(migration.source_suspended_at) })}
              </span>
            ) : (
              t('migrationdetail.next.suspend.description')
            )
          }
          action={
            suspended ? (
              <Button variant="ghost" size="sm" leftIcon={<PlayCircleIcon />} onClick={onUnsuspend}>
                {t('migrationdetail.next.suspend.undo')}
              </Button>
            ) : (
              <Button variant="primary" size="sm" leftIcon={<PauseCircleIcon />} onClick={onSuspend}>
                {t.rich('migrationdetail.next.suspend.button', { server })}
              </Button>
            )
          }
        />
      </Checklist>
    </Card>
  );
}

export default NextStepsCard;
