import { useState } from 'react';
import { ShieldCheckIcon, ShieldExclamationIcon } from '@heroicons/react/24/outline';
import { ArchiveBoxArrowDownIcon, ForwardIcon, StopIcon } from '@heroicons/react/20/solid';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, ConfirmDialog } from '../ui';
import type { ScanFinding, ScanReport, ScanSeverity } from '../../types';
import { formatBytes } from '../../lib/format';

const SEVERITY_TONE: Record<ScanSeverity, 'danger' | 'orange' | 'warning' | 'info'> = {
  critical: 'danger',
  high: 'orange',
  medium: 'warning',
  info: 'info',
};

const SEVERITY_ORDER: ScanSeverity[] = ['critical', 'high', 'medium', 'info'];

const ACTION_LABEL: Record<string, string> = {
  quarantine: 'Quarantine',
  restore_core: 'Restore core file',
  remove_lines: 'Strip directive',
  report: 'Review manually',
};

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
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <Badge tone={SEVERITY_TONE[f.severity]} size="sm" className="mt-0.5 w-16 justify-center uppercase">
          {f.severity}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="truncate text-left font-mono text-[13px] font-medium text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
              title={f.path}
            >
              {f.path}
            </button>
            <span className="text-2xs text-slate-400 dark:text-slate-500">{f.category.replace(/_/g, ' ')}</span>
            {f.domain && <span className="text-2xs text-slate-400 dark:text-slate-500">· {f.domain}</span>}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400" title={f.evidence}>
            {f.evidence}
          </div>
          {open && (
            <div className="mt-1.5 space-y-1 rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              {f.line ? <div>Line {f.line}</div> : null}
              {f.note && <div>{f.note}</div>}
              <div>
                Action: <span className="font-medium">{ACTION_LABEL[f.action] ?? f.action}</span>
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0">
          {f.cleaned ? (
            <Badge tone="success" size="sm" dot>
              Cleaned
            </Badge>
          ) : f.cleanable ? (
            <Badge tone="neutral" size="sm">
              {ACTION_LABEL[f.action] ?? f.action}
            </Badge>
          ) : (
            <Badge tone="neutral" size="sm">
              Manual review
            </Badge>
          )}
        </div>
      </div>
    </li>
  );
}

/** Findings of the staging-server malware scan, with the clean / continue / abort decision while the run waits. */
export function ScanReportPanel({ report, decision, decided }: ScanReportPanelProps) {
  const [cleanOpen, setCleanOpen] = useState(false);
  const [abortOpen, setAbortOpen] = useState(false);
  const findings = report.findings ?? [];
  const counts = report.counts ?? {};
  const cleanable = report.cleanable ?? 0;
  const clean = findings.length === 0 || findings.every((f) => f.severity === 'info');
  const HeroIcon = clean ? ShieldCheckIcon : ShieldExclamationIcon;
  const core = (report.domains ?? []).filter((d) => d.wordpress);
  const cleanup = report.cleanup;

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
            <CardTitle>{clean ? 'Malware scan: nothing suspicious' : `Malware scan: ${findings.length} finding${findings.length === 1 ? '' : 's'}`}</CardTitle>
            <CardDescription>
              {report.files_scanned?.toLocaleString() ?? 0} files ({formatBytes(report.bytes_scanned ?? 0)}) and {report.databases?.length ?? 0} database dump
              {(report.databases?.length ?? 0) === 1 ? '' : 's'} scanned on the staging server before upload.
              {report.clamav && report.clamav !== 'not installed' && report.clamav !== 'skipped' ? ` ClamAV: ${report.clamav}.` : ''}
            </CardDescription>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {SEVERITY_ORDER.map((sev) =>
            counts[sev] ? (
              <Badge key={sev} tone={SEVERITY_TONE[sev]} size="sm">
                {counts[sev]} {sev}
              </Badge>
            ) : null,
          )}
          {cleanable > 0 && !cleanup && (
            <Badge tone="success" size="sm">
              {cleanable} auto-cleanable
            </Badge>
          )}
          {core.map((d) => (
            <Badge key={d.domain} tone={d.core_checked ? (d.core_modified + d.core_extra > 0 ? 'danger' : 'success') : 'neutral'} size="sm" mono>
              {d.domain}: WordPress {d.core_version || '?'}{' '}
              {d.core_checked ? `core ${d.core_modified} modified, ${d.core_extra} extra` : 'core not checked'}
            </Badge>
          ))}
          {report.admin_users?.length ? (
            <Badge tone="info" size="sm">
              {report.admin_users.length} WordPress admin{report.admin_users.length === 1 ? '' : 's'}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      {findings.length > 0 && (
        <ul className="-mx-6 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
          {findings.map((f) => (
            <FindingRow key={f.id} f={f} />
          ))}
        </ul>
      )}

      {report.notes?.length ? (
        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {report.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      ) : null}

      {cleanup && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <div className="font-medium">
            Cleanup done: {cleanup.quarantined.length} quarantined, {cleanup.restored.length} core file{cleanup.restored.length === 1 ? '' : 's'} restored,{' '}
            {cleanup.lines_removed.length} config file{cleanup.lines_removed.length === 1 ? '' : 's'} stripped
            {cleanup.errors.length ? `, ${cleanup.errors.length} error${cleanup.errors.length === 1 ? '' : 's'}` : ''}.
          </div>
          <div className="mt-1 text-xs opacity-80">
            Nothing was deleted: quarantined files stay on the staging server at <span className="font-mono">{cleanup.quarantine_dir}</span> until the
            migration's work directory is removed.
          </div>
          {cleanup.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-rose-700 dark:text-rose-300">
              {cleanup.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {decided && !decision && (
        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Decision: <span className="font-medium">{decided === 'clean' ? 'cleaned before upload' : decided === 'skip' ? 'uploaded without cleaning' : 'migration aborted'}</span>
        </div>
      )}

      {decision && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Button variant="primary" leftIcon={<ArchiveBoxArrowDownIcon />} onClick={() => setCleanOpen(true)} loading={decision.busy} disabled={cleanable === 0}>
            Clean and continue
          </Button>
          <Button variant="secondary" leftIcon={<ForwardIcon />} onClick={decision.onSkip} disabled={decision.busy}>
            Continue without cleaning
          </Button>
          <Button variant="danger" leftIcon={<StopIcon />} onClick={() => setAbortOpen(true)} disabled={decision.busy}>
            Abort migration
          </Button>
          <span className="text-xs text-slate-500 dark:text-slate-400">The upload to the target has not started yet.</span>

          <ConfirmDialog
            open={cleanOpen}
            onClose={() => setCleanOpen(false)}
            tone="brand"
            title="Clean the staging copy?"
            message={
              <>
                {cleanable} finding{cleanable === 1 ? '' : 's'} will be handled automatically: flagged files and directories are moved to a quarantine folder on
                the staging server (not deleted), modified WordPress core files are replaced with the pristine release copy, and injected directives are
                stripped from config files. Database findings and "manual review" items stay for you to check after import.
              </>
            }
            confirmLabel="Clean and continue"
            onConfirm={async () => {
              await decision.onClean();
              setCleanOpen(false);
            }}
          />
          <ConfirmDialog
            open={abortOpen}
            onClose={() => setAbortOpen(false)}
            title="Abort this migration?"
            message={<>Nothing has been uploaded to the target. The website created on the cluster node (if any) is left in place for a re-run.</>}
            confirmLabel="Abort migration"
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
