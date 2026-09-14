import { ArrowLeftIcon, PlayIcon } from '@heroicons/react/16/solid';
import {
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  KeyValue,
  Mono,
  PanelBadge,
  PanelMonogram,
  Table,
  TBody,
  TD,
  TDPrimary,
  TH,
  THead,
  TR,
  Wire,
  panelTone,
} from '../ui';
import { useT } from '../../lib/i18n';
import type { ClusterServer } from '../../api/client';
import type { Account, Server } from '../../types';
import type { MigrationStepStatus } from './types';

interface ServerSummaryCardProps {
  title: string;
  server: Server | undefined;
  node?: ClusterServer;
}

function ServerSummaryCard({ title, server, node }: ServerSummaryCardProps) {
  const t = useT();
  const items = [
    { label: t('newmigration.review.server'), value: server?.name ?? '—' },
    { label: t('newmigration.review.host'), value: server?.host ?? '—', mono: true },
    { label: t('newmigration.review.panel'), value: <PanelBadge panelType={server?.panel_type} size="sm" /> },
  ];
  if (node) {
    items.push({
      label: t('newmigration.review.node'),
      value: (
        <span className="inline-flex items-center gap-1.5">
          <span>{node.friendly_name || node.hostname}</span>
          {node.ip && <Mono className="text-[13px] text-slate-500 dark:text-slate-400">{node.ip}</Mono>}
        </span>
      ),
    });
  }
  return (
    <Card edge={server ? panelTone(server.panel_type) : 'neutral'} className="min-w-0">
      <CardHeader>
        <div className="flex items-center gap-3">
          <PanelMonogram panelType={server?.panel_type} size="md" />
          <div className="min-w-0">
            <p className="eyebrow">{title}</p>
            <CardTitle as="h3" className="truncate">
              {server?.name ?? '—'}
            </CardTitle>
          </div>
        </div>
      </CardHeader>
      <KeyValue divided items={items} />
    </Card>
  );
}

export interface ReviewStepProps {
  sourceServer: Server | undefined;
  targetServer: Server | undefined;
  targetNode: ClusterServer | undefined;
  accounts: Account[];
  /** Steps the run will go through, in order (ids starting with `export_` are the export phase). */
  plan: Pick<MigrationStepStatus, 'id' | 'name'>[];
  /** Scan the staged export for malware on the middle server before uploading. */
  scanMalware: boolean;
  onScanMalwareChange: (value: boolean) => void;
  starting: boolean;
  onStart: () => void;
  onBack: () => void;
}

interface PlanColumnProps {
  title: string;
  steps: Pick<MigrationStepStatus, 'id' | 'name'>[];
  /** Number to start counting from (continues across columns). */
  offset: number;
}

function PlanColumn({ title, steps, offset }: PlanColumnProps) {
  const t = useT();
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <ol className="mt-3 space-y-1.5">
        {steps.map((step, i) => (
          <li key={step.id} className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 font-mono text-2xs tabular text-slate-500 dark:border-white/[0.15] dark:text-slate-400"
              aria-hidden="true"
            >
              {offset + i + 1}
            </span>
            {t(`steps.${step.id}.name`)}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Final confirmation before the migration starts. */
export function ReviewStep({ sourceServer, targetServer, targetNode, accounts, plan, scanMalware, onScanMalwareChange, starting, onStart, onBack }: ReviewStepProps) {
  const t = useT();
  const exportSteps = plan.filter((s) => s.id.startsWith('export_'));
  const importSteps = plan.filter((s) => !s.id.startsWith('export_'));
  const targetName = targetNode?.friendly_name || targetNode?.hostname || targetServer?.name || t('newmigration.review.targetFallback');

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
        <ServerSummaryCard title={t('newmigration.review.source')} server={sourceServer} />
        <Wire status="pending" className="mx-auto" />
        <ServerSummaryCard title={t('newmigration.review.target')} server={targetServer} node={targetNode} />
      </div>

      <Card flush>
        <CardHeader divided>
          <CardTitle>{t('newmigration.review.accounts.title')}</CardTitle>
          <CardDescription>{t('newmigration.review.accounts.description', { count: accounts.length })}</CardDescription>
        </CardHeader>
        <Table bare stickyHeader maxHeight="40vh">
          <THead>
            <TR hoverable={false}>
              <TH>{t('newmigration.table.domain')}</TH>
              <TH>{t('newmigration.table.username')}</TH>
              <TH numeric>{t('newmigration.table.disk')}</TH>
              <TH numeric>{t('newmigration.table.databases')}</TH>
              <TH numeric>{t('newmigration.table.mailboxes')}</TH>
            </TR>
          </THead>
          <TBody>
            {accounts.map((account) => (
              <TR key={account.username}>
                <TDPrimary>{account.domain ? <Mono className="text-[13px]">{account.domain}</Mono> : '—'}</TDPrimary>
                <TD mono>{account.username}</TD>
                <TD numeric>{account.disk_used ? <Mono className="text-[13px]">{account.disk_used}</Mono> : '—'}</TD>
                <TD numeric>{account.databases?.length ?? 0}</TD>
                <TD numeric>{account.email_accounts?.length ?? 0}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('newmigration.review.plan.title')}</CardTitle>
          <CardDescription>{t('newmigration.review.plan.description', { steps: t('units.steps', { count: plan.length }) })}</CardDescription>
        </CardHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          <PlanColumn title={t('steps.phase.export', { name: sourceServer?.name ?? t('newmigration.review.sourceFallback') })} steps={exportSteps} offset={0} />
          <PlanColumn title={t('steps.phase.import', { name: targetName })} steps={importSteps} offset={exportSteps.length} />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('newmigration.review.options.title')}</CardTitle>
          <CardDescription>{t('newmigration.review.options.description')}</CardDescription>
        </CardHeader>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50 dark:border-white/[0.08] dark:hover:bg-white/[0.03]">
          <Checkbox className="mt-0.5" checked={scanMalware} onChange={(e) => onScanMalwareChange(e.target.checked)} />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{t('newmigration.review.scan.title')}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('newmigration.review.scan.description')}</span>
          </span>
        </label>
        <CardFooter>
          <Button variant="secondary" leftIcon={<ArrowLeftIcon className="flip-rtl" />} onClick={onBack} disabled={starting}>
            {t('common.back')}
          </Button>
          <Button variant="primary" leftIcon={<PlayIcon className="flip-rtl" />} onClick={onStart} loading={starting}>
            {t('newmigration.review.start')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default ReviewStep;
