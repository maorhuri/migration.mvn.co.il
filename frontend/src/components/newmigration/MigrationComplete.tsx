import { CheckCircleIcon, ExclamationTriangleIcon, ListBulletIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/20/solid';
import { Button, Card, CardDescription, CardHeader, CardTitle, CodeBlock, Stat } from '../ui';
import { cn } from '../../lib/cn';
import type { Account, MigrationLog } from '../../types';

export interface MigrationCompleteProps {
  warningCount: number;
  warningLogs: MigrationLog[];
  targetNode: string;
  accounts: Account[];
  stepsCompleted: number;
  hostsEntry: string;
  onStartNew: () => void;
  onViewAll: () => void;
}

/** Summary shown once every selected account has migrated. */
export function MigrationComplete({ warningCount, warningLogs, targetNode, accounts, stepsCompleted, hostsEntry, onStartNew, onViewAll }: MigrationCompleteProps) {
  const hasWarnings = warningCount > 0;
  const HeroIcon = hasWarnings ? ExclamationTriangleIcon : CheckCircleIcon;

  return (
    <div className="space-y-6">
      <section
        className={cn(
          'rounded-xl border px-6 py-8 text-center shadow-sm sm:py-10',
          hasWarnings
            ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
            : 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10',
        )}
        aria-live="polite"
      >
        <div
          className={cn(
            'mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full',
            hasWarnings ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300',
          )}
          aria-hidden="true"
        >
          <HeroIcon className="h-8 w-8" />
        </div>
        <h2 className={cn('text-2xl font-semibold tracking-tight', hasWarnings ? 'text-amber-900 dark:text-amber-100' : 'text-emerald-900 dark:text-emerald-100')}>
          {hasWarnings ? 'Migration completed with warnings' : 'Migration completed'}
        </h2>
        <p className={cn('mx-auto mt-2 max-w-xl text-sm text-balance', hasWarnings ? 'text-amber-800 dark:text-amber-200' : 'text-emerald-800 dark:text-emerald-200')}>
          {hasWarnings
            ? 'Files, databases and permissions are in place. Review the warnings below before switching DNS.'
            : 'Files, databases, permissions and settings were migrated and verified.'}
        </p>
        {targetNode && (
          <p className={cn('mt-2 text-xs', hasWarnings ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300')}>
            Target node <span className="font-mono">{targetNode}</span>
          </p>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Accounts" value={accounts.length} icon={UserGroupIcon} tone="brand" />
        <Stat label="Steps completed" value={stepsCompleted} icon={ListBulletIcon} tone="success" />
        <Stat label="Warnings" value={warningCount} icon={ExclamationTriangleIcon} tone={hasWarnings ? 'warning' : 'neutral'} />
      </div>

      {warningLogs.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/30 dark:bg-amber-500/10 sm:p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-amber-900 dark:text-amber-100">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            Things to check manually
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm text-amber-800 dark:text-amber-200">
            {warningLogs.map((log) => (
              <li key={log.id} className="flex gap-2">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                <span className="min-w-0 break-words">{log.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Test before switching DNS</CardTitle>
          <CardDescription>Add this line to your hosts file to preview the migrated sites on the new server.</CardDescription>
        </CardHeader>
        <CodeBlock title="/etc/hosts" code={hostsEntry} copiedMessage="Hosts entry copied" />
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Windows: <span className="font-mono text-slate-700 dark:text-slate-300">C:\Windows\System32\drivers\etc\hosts</span>
          <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
          macOS / Linux: <span className="font-mono text-slate-700 dark:text-slate-300">/etc/hosts</span>
        </p>
      </Card>

      <Card flush>
        <CardHeader divided>
          <CardTitle>Migrated accounts</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {accounts.map((account) => (
            <li key={account.username} className="flex items-center gap-3 px-5 py-2.5 sm:px-6">
              <CheckCircleSolid className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
              <span className="min-w-0 truncate text-sm font-medium text-slate-900 dark:text-slate-100">{account.domain || account.username}</span>
              <span className="min-w-0 truncate font-mono text-xs text-slate-500 dark:text-slate-400">{account.username}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onStartNew}>
          Start new migration
        </Button>
        <Button variant="primary" onClick={onViewAll}>
          View all migrations
        </Button>
      </div>
    </div>
  );
}

export default MigrationComplete;
