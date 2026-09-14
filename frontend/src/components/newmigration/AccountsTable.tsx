import { useEffect, useRef, type MouseEvent } from 'react';
import { CircleStackIcon, EnvelopeIcon } from '@heroicons/react/16/solid';
import { Badge, Checkbox, Mono, StatusBadge, Table, TBody, TD, TDPrimary, TH, THead, TR, type SortDirection } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import type { Account } from '../../types';

interface CountPillProps {
  count: number;
  icon: React.ReactNode;
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

/** Clickable count that opens a detail modal (databases / mailboxes). */
function CountPill({ count, icon, label, onClick }: CountPillProps) {
  if (count === 0) {
    return <span className="tabular text-slate-400 dark:text-slate-500">0</span>;
  }
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md bg-slate-100 px-2 text-xs font-medium tabular text-slate-700 ring-1 ring-inset ring-slate-200 transition-colors',
        'hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/[0.1] dark:hover:bg-brand-500/15 dark:hover:text-brand-300 dark:hover:ring-brand-500/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:focus-visible:ring-brand-300 [&_svg]:h-3.5 [&_svg]:w-3.5',
      )}
    >
      <span className="text-slate-400 dark:text-slate-500" aria-hidden="true">
        {icon}
      </span>
      {count}
    </button>
  );
}

export interface AccountsTableProps {
  /** Filtered + sorted accounts to render. */
  accounts: Account[];
  selectedUsernames: Set<string>;
  /** Whether the header checkbox should read as "all selected" (page logic decides). */
  allSelected: boolean;
  onToggle: (account: Account) => void;
  onToggleAll: () => void;
  sortField: string;
  sortDirection: SortDirection;
  onSort: (field: string) => void;
  onShowEmails: (account: Account) => void;
  onShowDatabases: (account: Account) => void;
}

/**
 * Dense, sortable, multi-select table of hosting accounts on the source server.
 * Sorting and selection state live in the page; this component only renders.
 */
export function AccountsTable({
  accounts,
  selectedUsernames,
  allSelected,
  onToggle,
  onToggleAll,
  sortField,
  sortDirection,
  onSort,
  onShowEmails,
  onShowDatabases,
}: AccountsTableProps) {
  const t = useT();
  const headerCheckbox = useRef<HTMLInputElement | null>(null);
  const someSelected = accounts.some((a) => selectedUsernames.has(a.username));

  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = !allSelected && someSelected;
  }, [allSelected, someSelected]);

  const sorted = (field: string) => (sortField === field ? sortDirection : false);

  return (
    <Table bare stickyHeader maxHeight="60vh">
      <THead>
        <TR hoverable={false}>
          <TH className="w-10 pe-0">
            <Checkbox
              ref={headerCheckbox}
              checked={accounts.length > 0 && allSelected}
              onChange={onToggleAll}
              aria-label={t('newmigration.table.selectAll')}
              className="align-middle"
            />
          </TH>
          <TH sortable sorted={sorted('domain')} onSort={() => onSort('domain')}>
            {t('newmigration.table.domain')}
          </TH>
          <TH sortable sorted={sorted('php_version')} onSort={() => onSort('php_version')} align="center">
            {t('newmigration.table.php')}
          </TH>
          <TH sortable sorted={sorted('disk_usage')} onSort={() => onSort('disk_usage')} numeric>
            {t('newmigration.table.disk')}
          </TH>
          <TH sortable sorted={sorted('db_size')} onSort={() => onSort('db_size')} numeric>
            {t('newmigration.table.dbSize')}
          </TH>
          <TH sortable sorted={sorted('db_count')} onSort={() => onSort('db_count')} align="center">
            {t('newmigration.table.databases')}
          </TH>
          <TH sortable sorted={sorted('email_count')} onSort={() => onSort('email_count')} align="center">
            {t('newmigration.table.mailboxes')}
          </TH>
          <TH>{t('newmigration.table.status')}</TH>
        </TR>
      </THead>
      <TBody>
        {accounts.map((account) => {
          const selected = selectedUsernames.has(account.username);
          const dbCount = account.databases?.length ?? 0;
          const emailCount = account.email_accounts?.length ?? 0;
          const name = account.domain || account.username;
          return (
            <TR key={account.username} clickable selected={selected} onClick={() => onToggle(account)}>
              <TD className="w-10 pe-0" onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={selected} onChange={() => onToggle(account)} aria-label={t('a11y.selectX', { name })} className="align-middle" />
              </TD>
              <TDPrimary>
                <div className="flex items-center gap-2">
                  {account.domain ? (
                    <Mono className="text-[13px]">{account.domain}</Mono>
                  ) : (
                    <span className="font-normal text-slate-400 dark:text-slate-500">{t('newmigration.table.noDomain')}</span>
                  )}
                  {account.is_wordpress && (
                    <Badge tone="brand" size="sm">
                      {t('newmigration.table.wordpress')}
                    </Badge>
                  )}
                  {account.ssl_enabled && (
                    <Badge tone="success" size="sm">
                      {t('newmigration.table.ssl')}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                  <Mono>{account.username}</Mono>
                </div>
              </TDPrimary>
              <TD align="center">
                {account.php_version ? (
                  <Badge tone="neutral" size="sm" mono>
                    {account.php_version}
                  </Badge>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">—</span>
                )}
              </TD>
              <TD numeric>{account.disk_used ? <Mono className="text-[13px]">{account.disk_used}</Mono> : <span className="text-slate-400 dark:text-slate-500">—</span>}</TD>
              <TD numeric muted>
                {account.db_size ? <Mono className="text-[13px]">{account.db_size}</Mono> : <span className="text-slate-400 dark:text-slate-500">—</span>}
              </TD>
              <TD align="center">
                <CountPill
                  count={dbCount}
                  icon={<CircleStackIcon />}
                  label={t('newmigration.table.viewItems', { items: t('units.databases', { count: dbCount }), name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowDatabases(account);
                  }}
                />
              </TD>
              <TD align="center">
                <CountPill
                  count={emailCount}
                  icon={<EnvelopeIcon />}
                  label={t('newmigration.table.viewItems', { items: t('units.mailboxes', { count: emailCount }), name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowEmails(account);
                  }}
                />
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
