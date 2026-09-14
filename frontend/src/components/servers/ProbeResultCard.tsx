import type { ReactNode } from 'react';
import { ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/16/solid';
import { Badge, Figure, FigureStrip, KeyValue, Mono, StatusBadge } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { formatBytes, formatNumber } from '../../lib/format';
import { classifyProbeError } from '../../lib/agentless';
import type { AgentlessInfo, ServerTestResponse } from '../../types';

export interface ProbeResultCardProps {
  result: ServerTestResponse;
  className?: string;
}

/** A size that may arrive as a number of bytes or as a preformatted string ("324.8 MB"). */
function sizeLabel(v: number | string | undefined): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return typeof v === 'number' ? formatBytes(v) : v;
}

function Flag({ tone, title, hint }: { tone: 'warning' | 'info'; title: string; hint: string }) {
  const Icon = tone === 'warning' ? ExclamationTriangleIcon : InformationCircleIcon;
  return (
    <li
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        tone === 'warning'
          ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
          : 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed opacity-80">{hint}</span>
      </span>
    </li>
  );
}

/** The helper's facts as a compact strip + key/value grid + caching-plugin flags. */
function ProbeFacts({ info }: { info: AgentlessInfo }) {
  const t = useT();
  const files = info.files;
  const filesValue = files?.count !== undefined ? formatNumber(files.count) : '—';
  const filesHint = [sizeLabel(files?.bytes), files?.partial ? t('servers.probe.filesPartial') : undefined].filter(Boolean).join(' · ');
  const dbName = info.db?.name;
  const dbSize = sizeLabel(info.db?.size);
  const limits = [
    info.max_execution_time !== undefined && info.max_execution_time !== '' ? `${info.max_execution_time}s` : null,
    info.memory_limit || null,
  ].filter(Boolean);
  const plugins = info.plugins;
  const activeCount = plugins?.active?.length ?? 0;
  const flags: ReactNode[] = [];
  if (plugins?.litespeed_cache) flags.push(<Flag key="ls" tone="warning" title={t('servers.probe.plugins.litespeed')} hint={t('servers.probe.plugins.litespeed.hint')} />);
  if (plugins?.wp_rocket) flags.push(<Flag key="wpr" tone="warning" title={t('servers.probe.plugins.wpRocket')} hint={t('servers.probe.plugins.wpRocket.hint')} />);
  if (plugins?.object_cache) flags.push(<Flag key="oc" tone="info" title={t('servers.probe.plugins.objectCache')} hint={t('servers.probe.plugins.objectCache.hint')} />);

  return (
    <div className="space-y-4">
      <FigureStrip columns={4}>
        <Figure
          size="sm"
          label={t('servers.probe.wordpress')}
          value={info.wordpress ? <Mono>{info.wp_version || '—'}</Mono> : t('servers.probe.notWordpress')}
          tone={info.wordpress ? 'neutral' : 'warning'}
          hint={info.wordpress && info.multisite ? t('servers.probe.multisite') : undefined}
        />
        <Figure size="sm" label={t('servers.probe.php')} value={info.php_version ? <Mono>{info.php_version}</Mono> : '—'} />
        <Figure size="sm" label={t('servers.probe.files')} value={filesValue} hint={filesHint || undefined} />
        <Figure
          size="sm"
          label={t('servers.probe.database')}
          value={dbName ? <Mono>{dbName}</Mono> : t('servers.probe.noDatabase')}
          tone={dbName ? 'neutral' : 'warning'}
          hint={dbSize}
        />
      </FigureStrip>

      <KeyValue
        layout="grid"
        columns={3}
        items={[
          {
            label: t('servers.probe.exec'),
            value: (
              <Badge tone={info.exec ? 'success' : 'warning'} size="sm" dot>
                {info.exec ? t('servers.probe.exec.yes') : t('servers.probe.exec.no')}
              </Badge>
            ),
          },
          { label: t('servers.probe.diskFree'), value: sizeLabel(info.disk_free), mono: true },
          { label: t('servers.probe.limits'), value: limits.length ? limits.join(' / ') : undefined, mono: true },
          { label: t('servers.probe.docroot'), value: info.docroot, mono: true, span: true },
          { label: t('servers.probe.tmpDir'), value: info.tmp_dir, mono: true, span: true },
          ...(info.table_prefix ? [{ label: t('servers.probe.tablePrefix'), value: info.table_prefix, mono: true }] : []),
        ]}
      />

      {info.wordpress && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">{t('servers.probe.plugins')}</p>
            <span className="text-xs text-slate-500 tabular dark:text-slate-400">{t('servers.probe.plugins.active', { count: activeCount })}</span>
          </div>
          {flags.length > 0 ? (
            <ul className="mt-2 space-y-2">{flags}</ul>
          ) : (
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t('servers.probe.plugins.none')}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the agentless helper reported for an FTP / WordPress source: connection state, then
 * either the site facts (versions, files, database, exec, caching plugins) or a clearly
 * classified error (WAF, wrong credentials, no wp-config) with the raw server message.
 */
export function ProbeResultCard({ result, className }: ProbeResultCardProps) {
  const t = useT();
  const ok = result.success;
  const kind = ok ? null : classifyProbeError(result.message);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={ok ? 'connected' : 'disconnected'} />
        {ok && result.message && (
          <bdi dir="auto" className="min-w-0 truncate text-sm text-slate-500 dark:text-slate-400" title={result.message}>
            {result.message}
          </bdi>
        )}
      </div>

      {ok && result.info ? (
        <ProbeFacts info={result.info} />
      ) : (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/30 dark:bg-rose-500/10">
          <p className="flex items-start gap-2 text-sm font-semibold text-rose-800 dark:text-rose-200">
            <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t(`servers.probe.error.${kind ?? 'generic'}`)}
          </p>
          <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{t(`servers.probe.error.${kind ?? 'generic'}.hint`)}</p>
          {result.message && (
            <div className="mt-3">
              <p className="eyebrow text-rose-700/80 dark:text-rose-300/80">{t('servers.probe.error.message')}</p>
              <bdi dir="auto" className="mt-1 block whitespace-pre-wrap break-words font-mono text-xs text-rose-900 dark:text-rose-100">
                {result.message}
              </bdi>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ProbeResultCard;
