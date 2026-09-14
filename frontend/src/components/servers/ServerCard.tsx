import type { CSSProperties, ReactNode } from 'react';
import { ArrowPathIcon, ArrowRightIcon, PencilSquareIcon, SignalIcon, TrashIcon } from '@heroicons/react/20/solid';
import { Badge, Button, Card, IconButton, Mono, PanelBadge, PanelMonogram, Skeleton, StatusBadge, Tooltip, panelTone, surfaceClasses } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { formatDate, formatRelativeTime } from '../../lib/format';
import type { Server } from '../../types';

/** Result of the last "Test connection" click in this session (no API change: the page keeps it in state). */
export interface ServerTestResult {
  ok: boolean;
  at: Date;
}

export interface ServerCardProps {
  server: Server;
  testing: boolean;
  refreshing: boolean;
  /** Inline presence chip next to the test button, set by the page after the existing handler resolves. */
  lastTest?: ServerTestResult;
  onTest: () => void;
  onRefresh: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  className?: string;
  style?: CSSProperties;
}

function Row({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="eyebrow shrink-0">{label}</dt>
      <dd className="min-w-0 text-end text-[13px] text-slate-700 dark:text-slate-300" title={title}>
        {children}
      </dd>
    </div>
  );
}

/**
 * One server, one answer: can I reach this box and what is on it.
 * Panel identity on the top edge and the monogram; actions reveal on hover and stay keyboard-reachable.
 */
export function ServerCard({ server, testing, refreshing, lastTest, onTest, onRefresh, onView, onEdit, onDelete, className, style }: ServerCardProps) {
  const t = useT();
  const isTarget = server.panel_type === 'enhance';

  return (
    <Card
      edge={panelTone(server.panel_type)}
      className={cn('group relative flex flex-col motion-safe:animate-rise stagger', className)}
      style={style}
      data-testid={`server-card-${server.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <PanelMonogram panelType={server.panel_type} size="lg" />
          <div className="min-w-0">
            <h3 className="min-w-0 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100" title={server.name}>
              {/* dir="auto" inline-block: a Latin name truncates at its own end in RTL instead of losing its first letters. */}
              <bdi dir="auto" className="inline-block max-w-full truncate align-bottom">
                {server.name}
              </bdi>
            </h3>
            <div className="mt-1 flex items-center gap-2">
              <PanelBadge panelType={server.panel_type} size="sm" />
              <span className="text-xs text-slate-400 dark:text-slate-500">{isTarget ? t('servers.card.role.target') : t('servers.card.role.source')}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 motion-reduce:opacity-100 [@media(hover:none)]:opacity-100">
          {server.panel_type !== 'enhance' && (
            <Tooltip content={t('servers.card.refresh')} side="bottom" align="end">
              <IconButton
                aria-label={t('servers.card.refreshAria', { name: server.name })}
                icon={<ArrowPathIcon />}
                size="sm"
                tone="success"
                loading={refreshing}
                onClick={onRefresh}
              />
            </Tooltip>
          )}
          <Tooltip content={t('servers.card.edit')} side="bottom" align="end">
            <IconButton aria-label={t('servers.card.editAria', { name: server.name })} icon={<PencilSquareIcon />} size="sm" tone="brand" onClick={onEdit} />
          </Tooltip>
          <Tooltip content={t('servers.card.delete')} side="bottom" align="end">
            <IconButton aria-label={t('servers.card.deleteAria', { name: server.name })} icon={<TrashIcon />} size="sm" tone="danger" onClick={onDelete} />
          </Tooltip>
        </div>
      </div>

      <dl className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/[0.06] dark:border-white/[0.06]">
        <Row label={t('servers.card.host')} title={`${server.host}:${server.port}`}>
          <Mono className="text-slate-900 dark:text-slate-100">
            {server.host}
            <span className="text-slate-400 dark:text-slate-500">:{server.port}</span>
          </Mono>
        </Row>
        <Row label={t('servers.card.user')}>
          <Mono>{server.username}</Mono>
        </Row>
        <Row label={t('servers.card.auth')}>
          <Badge tone="neutral" size="sm">
            {t(`auth.${server.auth_method}`)}
          </Badge>
        </Row>
        <Row label={t('servers.card.added')}>
          <span title={formatDate(server.created_at)}>{formatRelativeTime(server.created_at)}</span>
        </Row>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-white/[0.06]">
        <Button variant="secondary" size="sm" leftIcon={<SignalIcon />} loading={testing} onClick={onTest}>
          {t('servers.card.test')}
        </Button>
        <span className="flex min-w-0 items-center" aria-live="polite">
          {testing ? (
            <StatusBadge status="testing" size="sm" />
          ) : lastTest ? (
            <StatusBadge
              key={lastTest.at.getTime()}
              status={lastTest.ok ? 'connected' : 'disconnected'}
              size="sm"
              title={t('servers.card.testedAt', { time: formatDate(lastTest.at.toISOString()) })}
              className="motion-safe:animate-scale-in"
            />
          ) : null}
        </span>
        <Button variant="ghost" size="sm" rightIcon={<ArrowRightIcon className="flip-rtl" />} onClick={onView} className="ms-auto">
          {t('servers.card.view')}
        </Button>
      </div>
    </Card>
  );
}

/** Loading twin of ServerCard (same rhythm: monogram row, four facts, two footer actions). Decorative only. */
export function ServerCardSkeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={cn(surfaceClasses, 'p-6', className)} style={style} aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/[0.06] dark:border-white/[0.06]">
        {['w-40', 'w-16', 'w-20', 'w-24'].map((w) => (
          <div key={w} className="flex items-center justify-between py-2.5">
            <Skeleton className="h-3 w-12" />
            <Skeleton className={cn('h-3.5', w)} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 dark:border-white/[0.06]">
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="ms-auto h-8 w-24 rounded-md" />
      </div>
    </div>
  );
}

export default ServerCard;
