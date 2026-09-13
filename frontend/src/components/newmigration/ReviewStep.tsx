import { ArrowLeftIcon, PlayIcon } from '@heroicons/react/16/solid';
import {
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  Input,
  KeyValue,
  PanelBadge,
  Table,
  TBody,
  TD,
  TDPrimary,
  TH,
  THead,
  TR,
  panelTone,
  type BadgeTone,
  type CardProps,
} from '@/components/ui';
import type { ClusterServer } from '@/api/client';
import type { Account, Server } from '@/types';
import type { MigrationStepStatus } from './types';

function accentFor(tone: BadgeTone): CardProps['accent'] {
  switch (tone) {
    case 'violet':
    case 'blue':
    case 'orange':
    case 'info':
    case 'brand':
      return tone;
    default:
      return undefined;
  }
}

interface ServerSummaryCardProps {
  title: string;
  server: Server | undefined;
  node?: ClusterServer;
}

function ServerSummaryCard({ title, server, node }: ServerSummaryCardProps) {
  const items = [
    { label: 'Server', value: server?.name ?? '—' },
    { label: 'Host', value: server?.host ?? '—', mono: true },
    { label: 'Panel', value: <PanelBadge panelType={server?.panel_type} size="sm" /> },
  ];
  if (node) {
    items.push({
      label: 'Node',
      value: (
        <span className="inline-flex items-center gap-1.5">
          <span>{node.friendly_name || node.hostname}</span>
          {node.ip && <span className="font-mono text-[13px] text-slate-500 dark:text-slate-400">{node.ip}</span>}
        </span>
      ),
    });
  }
  return (
    <Card accent={server ? accentFor(panelTone(server.panel_type)) : undefined}>
      <CardHeader>
        <CardTitle as="h3">{title}</CardTitle>
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
  newPassword: string;
  onNewPasswordChange: (value: string) => void;
  starting: boolean;
  onStart: () => void;
  onBack: () => void;
}

interface PlanColumnProps {
  title: string;
  subtitle: string;
  steps: Pick<MigrationStepStatus, 'id' | 'name'>[];
  /** Number to start counting from (continues across columns). */
  offset: number;
}

function PlanColumn({ title, subtitle, steps, offset }: PlanColumnProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      <ol className="mt-3 space-y-1.5">
        {steps.map((step, i) => (
          <li key={step.id} className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 font-mono text-2xs tabular text-slate-500 dark:border-slate-600 dark:text-slate-400"
              aria-hidden="true"
            >
              {offset + i + 1}
            </span>
            {step.name}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Final confirmation before the migration starts. */
export function ReviewStep({ sourceServer, targetServer, targetNode, accounts, plan, newPassword, onNewPasswordChange, starting, onStart, onBack }: ReviewStepProps) {
  const exportSteps = plan.filter((s) => s.id.startsWith('export_'));
  const importSteps = plan.filter((s) => !s.id.startsWith('export_'));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <ServerSummaryCard title="Source" server={sourceServer} />
        <ServerSummaryCard title="Target" server={targetServer} node={targetNode} />
      </div>

      <Card flush>
        <CardHeader divided>
          <CardTitle>Accounts to migrate</CardTitle>
          <CardDescription>
            {accounts.length} account{accounts.length === 1 ? '' : 's'} will be exported from the source and recreated on the target.
          </CardDescription>
        </CardHeader>
        <Table bare stickyHeader maxHeight="40vh">
          <THead>
            <TR hoverable={false}>
              <TH>Domain</TH>
              <TH>Username</TH>
              <TH numeric>Disk</TH>
              <TH numeric>Databases</TH>
              <TH numeric>Mailboxes</TH>
            </TR>
          </THead>
          <TBody>
            {accounts.map((account) => (
              <TR key={account.username}>
                <TDPrimary>{account.domain || '—'}</TDPrimary>
                <TD mono>{account.username}</TD>
                <TD numeric>{account.disk_used || '—'}</TD>
                <TD numeric>{account.databases?.length ?? 0}</TD>
                <TD numeric>{account.email_accounts?.length ?? 0}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What will happen</CardTitle>
          <CardDescription>
            Each account runs through these {plan.length} steps in order. Nothing is changed on the source server.
          </CardDescription>
        </CardHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          <PlanColumn title="Export" subtitle={`From ${sourceServer?.name ?? 'the source server'}`} steps={exportSteps} offset={0} />
          <PlanColumn title="Import" subtitle={`To ${targetNode?.friendly_name || targetNode?.hostname || targetServer?.name || 'the target server'}`} steps={importSteps} offset={exportSteps.length} />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Options</CardTitle>
          <CardDescription>Everything else (files, databases, mailboxes, cron jobs, SSL) is migrated automatically.</CardDescription>
        </CardHeader>
        <div className="max-w-md">
          <Field label="New password" labelAddon="Optional" hint="Applied to the migrated account(s) on the target. Leave empty to keep the target's default behaviour.">
            <Input
              type="password"
              mono
              autoComplete="new-password"
              placeholder="••••••••••••"
              value={newPassword}
              onChange={(e) => onNewPasswordChange(e.target.value)}
            />
          </Field>
        </div>
        <CardFooter>
          <Button variant="secondary" leftIcon={<ArrowLeftIcon />} onClick={onBack} disabled={starting}>
            Back
          </Button>
          <Button variant="primary" leftIcon={<PlayIcon />} onClick={onStart} loading={starting}>
            Start migration
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default ReviewStep;
