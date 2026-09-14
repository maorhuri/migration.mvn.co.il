import { useState } from 'react';
import { ShieldCheckIcon, ShieldExclamationIcon } from '@heroicons/react/24/outline';
import { ArchiveBoxArrowDownIcon, ForwardIcon, StopIcon } from '@heroicons/react/20/solid';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, ConfirmDialog, Mono } from '../ui';
import { useT } from '../../lib/i18n';
import type { ScanFinding, ScanReport, ScanSeverity } from '../../types';
import { formatBytes, formatNumber } from '../../lib/format';

const SEVERITY_TONE: Record<ScanSeverity, 'danger' | 'orange' | 'warning' | 'info'> = {
  critical: 'danger',
  high: 'orange',
  medium: 'warning',
  info: 'info',
};

const SEVERITY_ORDER: ScanSeverity[] = ['critical', 'high', 'medium', 'info'];

/** Backend actions with a translated label; anything else is shown raw. */
const KNOWN_ACTIONS = new Set(['quarantine', 'restore_core', 'remove_lines', 'report']);

export interface ScanReportPanelProps {
  report: ScanReport;
  /** Present while the migration waits for a decision. */
  decision?: {
    busy: boolean;
    onClean: () => Promise<void> | void;
    onSkip: () => Promise<void> | void;
    onAbort: () => Promise<void> | void;
  };
  /** The recorded decision once one was made. */
  decided?: string;
}

function FindingRow({ f }: { f: ScanFinding }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const actionLabel = KNOWN_ACTIONS.has(f.action) ? t(`migrations.scan.action.${f.action}`) : f.action;
  return (
    <li className="px-6 py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <Badge tone={SEVERITY_TONE[f.severity]} size="sm" className="mt-0.5 min-w-16 justify-center uppercase">
          {t(`migrations.scan.severity.${f.severity}`)}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <button
              type="button"
              dir="ltr"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={t('migrations.scan.toggleDetails', { path: f.path })}
              className="max-w-full truncate rounded-sm text-start font-mono text-[13px] font-medium text-slate-900 transition-colors hover:text-brand-700 dark:text-slate-100 dark:hover:text-brand-300"
              title={f.path}
            >
              {f.path}
            </button>
            <bdi dir="ltr" className="text-2xs text-slate-400 dark:text-slate-500">
              {f.category.replace(/_/g, ' ')}
            </bdi>
            {f.domain && (
              <span className="text-2xs text-slate-400 dark:text-slate-500">
                <span aria-hidden="true">· </span>
                <Mono>{f.domain}</Mono>
              </span>
            )}
          </div>
          {f.evidence && (
            <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400" title={f.evidence}>
              <Mono className="text-xs">{f.evidence}</Mono>
            </div>
          )}
          {open && (
            <div className="mt-1.5 space-y-1 rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
              {f.line ? <div>{t('migrations.scan.line', { line: f.line })}</div> : null}
              {f.note && (
                <div>
                  <bdi dir="ltr">{f.note}</bdi>
                </div>
              )}
              <div>{t.rich('migrations.scan.actionLabel', { action: <span className="font-medium">{actionLabel}</span> })}</div>
            </div>
          )}
        </div>
        <div className="shrink-0">
          {f.cleaned ? (
            <Badge tone="success" size="sm" dot>
              {t('migrations.scan.cleaned')}
            </Badge>
          ) : f.cleanable ? (
            <Badge tone="neutral" size="sm">
              {actionLabel}
            </Badge>
          ) : (
            <Badge tone="neutral" size="sm">
              {t('migrations.scan.manualReview')}
            </Badge>
          )}
        </div>
      </div>
    </li>
  );
}

/** Findings of the staging-server malware scan, with the clean / continue / abort decision while the run waits. */
export function ScanReportPanel({ report, decision, decided }: ScanReportPanelProps) {
  const t = useT();
  const [cleanOpen, setCleanOpen] = useState(false);
  const [abortOpen, setAbortOpen] = useState(false);
  const findings = report.findings ?? [];
  const filesScanned = report.files_scanned ?? 0;
  const counts = report.counts ?? {};
  const cleanable = report.cleanable ?? 0;
  const clean = findings.length === 0 || findings.every((f) => f.severity === 'info');
  const HeroIcon = clean ? ShieldCheckIcon : ShieldExclamationIcon;
  const core = (report.domains ?? []).filter((d) => d.wordpress);
  const cleanup = report.cleanup;
  const showClamav = !!report.clamav && report.clamav !== 'not installed' && report.clamav !== 'skipped';

  const cleanupSummary = cleanup
    ? [
        t('migrations.scan.cleanup.quarantined', { count: cleanup.quarantined.length }),
        t('migrations.scan.cleanup.restored', { count: cleanup.restored.length }),
        t('migrations.scan.cleanup.stripped', { count: cleanup.lines_removed.length }),
        ...(cleanup.errors.length ? [t('migrations.scan.cleanup.errors', { count: cleanup.errors.length })] : []),
      ].join(', ')
    : '';

  const decidedLabel =
    decided === 'clean'
      ? t('migrations.scan.decision.clean')
      : decided === 'skip'
        ? t('migrations.scan.decision.skip')
        : t('migrations.scan.decision.abort');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div
            className={
              clean
                ? 'rounded-lg bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                : 'rounded-lg bg-rose-50 p-2 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
            }
          >
            <HeroIcon className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle>{clean ? t('migrations.scan.clean') : t('migrations.scan.findings', { count: findings.length })}</CardTitle>
            <CardDescription>
              {t.rich('migrations.scan.summary', {
                files: t('migrations.scan.files', { count: filesScanned, n: formatNumber(filesScanned) }),
                // A number next to a Latin unit inside Hebrew text reorders to "MB 700": isolate it.
                size: (
                  <bdi dir="ltr" className="tabular">
                    {formatBytes(report.bytes_scanned ?? 0)}
                  </bdi>
                ),
                dumps: t('migrations.scan.dumps', { count: report.databases?.length ?? 0 }),
              })}
              {showClamav && (
                <>
                  {' '}
                  <Mono>{t('migrations.scan.clamav', { value: report.clamav ?? '' })}</Mono>
                </>
              )}
            </CardDescription>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {SEVERITY_ORDER.map((sev) =>
            counts[sev] ? (
              <Badge key={sev} tone={SEVERITY_TONE[sev]} size="sm">
                {t(`migrations.scan.count.${sev}`, { count: counts[sev] ?? 0 })}
              </Badge>
            ) : null,
          )}
          {cleanable > 0 && !cleanup && (
            <Badge tone="success" size="sm">
              {t('migrations.scan.autoCleanable', { count: cleanable })}
            </Badge>
          )}
          {core.map((d) => (
            <Badge key={d.domain} tone={d.core_checked ? (d.core_modified + d.core_extra > 0 ? 'danger' : 'success') : 'neutral'} size="sm">
              <Mono>
                {d.domain}: WordPress {d.core_version || '?'}
              </Mono>
              <span>
                {d.core_checked ? t('migrations.scan.core.checked', { modified: d.core_modified, extra: d.core_extra }) : t('migrations.scan.core.unchecked')}
              </span>
            </Badge>
          ))}
          {report.admin_users?.length ? (
            <Badge tone="info" size="sm">
              {t('migrations.scan.admins', { count: report.admin_users.length })}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      {findings.length > 0 && (
        <ul className="-mx-6 divide-y divide-slate-100 border-t border-slate-200 dark:divide-white/[0.06] dark:border-white/[0.08]">
          {findings.map((f) => (
            <FindingRow key={f.id} f={f} />
          ))}
        </ul>
      )}

      {report.notes?.length ? (
        <div className="mt-3 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
          {report.notes.map((n, i) => (
            <div key={i}>
              <bdi dir="ltr">{n}</bdi>
            </div>
          ))}
        </div>
      ) : null}

      {cleanup && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <div className="font-medium">{t('migrations.scan.cleanup.title', { summary: cleanupSummary })}</div>
          <div className="mt-1 text-xs opacity-80">{t.rich('migrations.scan.cleanup.note', { dir: <Mono>{cleanup.quarantine_dir}</Mono> })}</div>
          {cleanup.errors.length > 0 && (
            <ul className="mt-2 list-disc ps-5 text-xs text-rose-700 dark:text-rose-300">
              {cleanup.errors.map((e, i) => (
                <li key={i}>
                  <bdi dir="ltr">{e}</bdi>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {decided && !decision && (
        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {t.rich('migrations.scan.decision', { decision: <span className="font-medium">{decidedLabel}</span> })}
        </div>
      )}

      {decision && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4 dark:border-white/[0.08]">
          <Button variant="primary" leftIcon={<ArchiveBoxArrowDownIcon />} onClick={() => setCleanOpen(true)} loading={decision.busy} disabled={cleanable === 0}>
            {t('migrations.scan.cleanContinue')}
          </Button>
          <Button variant="secondary" leftIcon={<ForwardIcon />} onClick={decision.onSkip} disabled={decision.busy}>
            {t('migrations.scan.skip')}
          </Button>
          <Button variant="danger" leftIcon={<StopIcon />} onClick={() => setAbortOpen(true)} disabled={decision.busy}>
            {t('migrations.scan.abort')}
          </Button>
          <span className="text-xs text-slate-500 dark:text-slate-400">{t('migrations.scan.notStarted')}</span>

          <ConfirmDialog
            open={cleanOpen}
            onClose={() => setCleanOpen(false)}
            tone="brand"
            title={t('migrations.scan.cleanDialog.title')}
            message={t('migrations.scan.cleanDialog.message', { count: cleanable })}
            confirmLabel={t('migrations.scan.cleanContinue')}
            onConfirm={async () => {
              await decision.onClean();
              setCleanOpen(false);
            }}
          />
          <ConfirmDialog
            open={abortOpen}
            onClose={() => setAbortOpen(false)}
            title={t('migrations.scan.abortDialog.title')}
            message={t('migrations.scan.abortDialog.message')}
            confirmLabel={t('migrations.scan.abort')}
            onConfirm={async () => {
              await decision.onAbort();
              setAbortOpen(false);
            }}
          />
        </div>
      )}
    </Card>
  );
}

export default ScanReportPanel;
