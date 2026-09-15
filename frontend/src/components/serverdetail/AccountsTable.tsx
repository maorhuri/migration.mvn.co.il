import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CircleStackIcon, EnvelopeIcon, LockClosedIcon } from '@heroicons/react/16/solid';
import { Badge, Mono, StatusBadge, Table, THead, TBody, TR, TH, TD, TDPrimary } from '../ui';
import type { SortDirection } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
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

/** Badge-shaped button used for "open the databases / mailboxes list" counts. */
function CountButton({ icon, count, tone, label, className, ...rest }: CountButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium tabular ring-1 ring-inset transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:focus-visible:ring-brand-300',
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

/** Muted zero for the count columns. */
function Zero() {
  return <span className="tabular text-slate-400 dark:text-slate-500">0</span>;
}

/** Muted "nothing here" dash. */
function Dash() {
  return <span className="text-slate-400 dark:text-slate-500">—</span>;
}

/** A size such as "608M" or "324.7 MB" — always LTR so the unit never jumps in front of the number in Hebrew. */
function Size({ value, muted }: { value?: string; muted?: boolean }) {
  if (!value) return <Dash />;
  return <Mono className={cn('text-xs', muted ? 'text-slate-500 dark:text-slate-400' : 'font-medium text-slate-900 dark:text-slate-100')}>{value}</Mono>;
}

export function AccountsTable({ accounts, sortField, sortDirection, onSort, onOpenDatabases, onOpenEmails }: AccountsTableProps) {
  const t = useT();
  const sorted = (field: AccountSortField) => (sortField === field ? sortDirection : false);

  return (
    <Table bare stickyHeader maxHeight="70vh">
      <THead>
        <TR hoverable={false}>
          <TH sortable sorted={sorted('domain')} onSort={() => onSort('domain')}>
            {t('serverdetail.table.domain')}
          </TH>
          <TH sortable sorted={sorted('type')} onSort={() => onSort('type')}>
            {t('serverdetail.table.type')}
          </TH>
          <TH sortable sorted={sorted('php')} onSort={() => onSort('php')}>
            {t('serverdetail.table.php')}
          </TH>
          <TH numeric sortable sorted={sorted('disk')} onSort={() => onSort('disk')}>
            {t('serverdetail.table.disk')}
          </TH>
          <TH numeric sortable sorted={sorted('db_size')} onSort={() => onSort('db_size')}>
            {t('serverdetail.table.dbSize')}
          </TH>
          <TH align="center" sortable sorted={sorted('dbs')} onSort={() => onSort('dbs')}>
            {t('serverdetail.table.databases')}
          </TH>
          <TH align="center" sortable sorted={sorted('emails')} onSort={() => onSort('emails')}>
            {t('serverdetail.table.mailboxes')}
          </TH>
          <TH>{t('serverdetail.table.status')}</TH>
        </TR>
      </THead>
      <TBody>
        {accounts.map((account) => {
          const dbCount = account.databases?.length || 0;
          const emailCount = account.email_accounts?.length || 0;
          // A DirectAdmin domain pointer is the account's real, customer-facing domain --
          // account.domain here is often just the internal hosting hostname it was provisioned
          // under, which is what actually gets migrated as an alias, not the live site's name.
          // Show the pointer as the primary name when there is one (same rule as the New
          // Migration wizard's account table).
          const primaryPointer = account.pointers?.[0];
          const displayDomain = primaryPointer || account.domain;
          return (
            <TR key={account.username}>
              <TDPrimary className="whitespace-nowrap">
                <div className="flex min-w-0 items-center gap-2">
                  {displayDomain ? <Mono className="text-[13px] font-medium">{displayDomain}</Mono> : <Dash />}
                  {account.ssl_enabled && (
                    <Badge
                      tone="success"
                      size="sm"
                      icon={<LockClosedIcon />}
                      title={account.ssl_expiry ? t('serverdetail.table.sslExpires', { date: account.ssl_expiry }) : t('serverdetail.table.sslEnabled')}
                    >
                      {t('serverdetail.table.ssl')}
                    </Badge>
                  )}
                </div>
                <div title={primaryPointer ? account.pointers?.join(', ') : undefined}>
                  <Mono block className="mt-0.5 text-2xs font-normal text-slate-500 dark:text-slate-400">
                    {account.username}
                    {primaryPointer && account.domain && ` · ${account.domain}`}
                  </Mono>
                </div>
              </TDPrimary>
              <TD>
                {account.is_wordpress ? (
                  <Badge tone="neutral" size="sm" title={t('serverdetail.table.wordpress')}>
                    <span aria-hidden="true">{t('serverdetail.table.wp')}</span>
                    <span className="sr-only">{t('serverdetail.table.wordpress')}</span>
                  </Badge>
                ) : (
                  <Dash />
                )}
              </TD>
              <TD>
                {account.php_version ? (
                  <Badge tone="neutral" size="sm" mono>
                    {account.php_version}
                  </Badge>
                ) : (
                  <Badge tone="warning" size="sm" mono title={t('serverdetail.table.phpUnknown')}>
                    ?
                  </Badge>
                )}
              </TD>
              <TD numeric>
                <Size value={account.disk_used} />
              </TD>
              <TD numeric>
                <Size value={account.db_size} muted />
              </TD>
              <TD align="center">
                {dbCount > 0 ? (
                  <CountButton
                    tone="violet"
                    icon={<CircleStackIcon />}
                    count={dbCount}
                    label={t('serverdetail.table.showDatabases', { count: dbCount, domain: displayDomain })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDatabases(account);
                    }}
                  />
                ) : (
                  <Zero />
                )}
              </TD>
              <TD align="center">
                {emailCount > 0 ? (
                  <CountButton
                    tone="sky"
                    icon={<EnvelopeIcon />}
                    count={emailCount}
                    label={t('serverdetail.table.showMailboxes', { count: emailCount, domain: displayDomain })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenEmails(account);
                    }}
                  />
                ) : (
                  <Zero />
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
