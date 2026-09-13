import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CircleStackIcon, EnvelopeIcon, LockClosedIcon } from '@heroicons/react/16/solid';
import { Badge, StatusBadge, Table, THead, TBody, TR, TH, TD, TDPrimary } from '../ui';
import type { SortDirection } from '../ui';
import { cn } from '../../lib/cn';
import type { Account } from '../../types';

export type AccountSortField = 'domain' | 'type' | 'php' | 'disk' | 'db_size' | 'dbs' | 'emails';

export interface AccountsTableProps {
  accounts: Account[];
  sortField: string;
  sortDirection: SortDirection;
  onSort: (field: AccountSortField) => void;
  onOpenDatabases: (account: Account) => void;
  onOpenEmails: (account: Account) => void;
}

interface CountButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ReactNode;
  count: number;
  tone: 'violet' | 'sky';
  label: string;
}

const countToneClasses = {
  violet:
    'bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100 ' +
    'dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30 dark:hover:bg-violet-500/25',
  sky:
    'bg-sky-50 text-sky-700 ring-sky-200 hover:bg-sky-100 ' +
    'dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30 dark:hover:bg-sky-500/25',
};

/** Badge-shaped button used for "open the databases / emails list" counts. */
function CountButton({ icon, count, tone, label, className, ...rest }: CountButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-2xs font-medium tabular-nums ring-1 ring-inset transition-colors',
        '[&_svg]:h-3 [&_svg]:w-3',
        countToneClasses[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      {count}
    </button>
  );
}

export function AccountsTable({ accounts, sortField, sortDirection, onSort, onOpenDatabases, onOpenEmails }: AccountsTableProps) {
  const sorted = (field: AccountSortField) => (sortField === field ? sortDirection : false);

  return (
    <Table bare stickyHeader maxHeight="70vh">
      <THead>
        <TR hoverable={false}>
          <TH sortable sorted={sorted('domain')} onSort={() => onSort('domain')}>
            Domain
          </TH>
          <TH>Username</TH>
          <TH sortable sorted={sorted('type')} onSort={() => onSort('type')}>
            Type
          </TH>
          <TH sortable sorted={sorted('php')} onSort={() => onSort('php')}>
            PHP
          </TH>
          <TH numeric sortable sorted={sorted('disk')} onSort={() => onSort('disk')}>
            Disk
          </TH>
          <TH numeric sortable sorted={sorted('db_size')} onSort={() => onSort('db_size')}>
            DB size
          </TH>
          <TH align="center" sortable sorted={sorted('dbs')} onSort={() => onSort('dbs')}>
            Databases
          </TH>
          <TH align="center" sortable sorted={sorted('emails')} onSort={() => onSort('emails')}>
            Emails
          </TH>
          <TH>Status</TH>
        </TR>
      </THead>
      <TBody>
        {accounts.map((account) => {
          const dbCount = account.databases?.length || 0;
          const emailCount = account.email_accounts?.length || 0;
          return (
            <TR key={account.username}>
              <TDPrimary className="max-w-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{account.domain || '—'}</span>
                  {account.ssl_enabled && (
                    <Badge tone="success" size="sm" icon={<LockClosedIcon />} title={account.ssl_expiry ? `Expires ${account.ssl_expiry}` : 'SSL enabled'}>
                      SSL
                    </Badge>
                  )}
                </div>
              </TDPrimary>
              <TD mono>{account.username}</TD>
              <TD>
                {account.is_wordpress ? (
                  <Badge tone="brand" size="sm">
                    WordPress
                  </Badge>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">—</span>
                )}
              </TD>
              <TD>
                <Badge tone={account.php_version ? 'neutral' : 'warning'} size="sm" mono>
                  {account.php_version || '?'}
                </Badge>
              </TD>
              <TD numeric className="font-medium">
                {account.disk_used || '—'}
              </TD>
              <TD numeric muted>
                {account.db_size || '—'}
              </TD>
              <TD align="center">
                {dbCount > 0 ? (
                  <CountButton
                    tone="violet"
                    icon={<CircleStackIcon />}
                    count={dbCount}
                    label={`Show ${dbCount} database${dbCount === 1 ? '' : 's'} for ${account.domain}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDatabases(account);
                    }}
                  />
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">0</span>
                )}
              </TD>
              <TD align="center">
                {emailCount > 0 ? (
                  <CountButton
                    tone="sky"
                    icon={<EnvelopeIcon />}
                    count={emailCount}
                    label={`Show ${emailCount} email account${emailCount === 1 ? '' : 's'} for ${account.domain}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenEmails(account);
                    }}
                  />
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">0</span>
                )}
              </TD>
              <TD>
                <StatusBadge status={account.suspended ? 'suspended' : 'active'} size="sm" />
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

export default AccountsTable;
