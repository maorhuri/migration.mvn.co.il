import { useEffect, useRef, type MouseEvent } from 'react';
import { CircleStackIcon, EnvelopeIcon } from '@heroicons/react/16/solid';
import { Badge, StatusBadge, Table, TBody, TD, TDPrimary, TH, THead, TR, type SortDirection } from '../ui';
import { cn } from '../../lib/cn';
import type { Account } from '../../types';

export const checkboxClasses =
  'h-4 w-4 cursor-pointer rounded border-slate-300 accent-indigo-600 dark:border-slate-600 dark:accent-indigo-500 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';

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
        'hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300 dark:hover:ring-indigo-500/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&_svg]:h-3.5 [&_svg]:w-3.5',
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
          <TH className="w-10 pr-0">
            <input
              ref={headerCheckbox}
              type="checkbox"
              className={checkboxClasses}
              checked={accounts.length > 0 && allSelected}
              onChange={onToggleAll}
              aria-label="Select all accounts"
            />
          </TH>
          <TH sortable sorted={sorted('domain')} onSort={() => onSort('domain')}>
            Domain
          </TH>
          <TH sortable sorted={sorted('php_version')} onSort={() => onSort('php_version')} align="center">
            PHP
          </TH>
          <TH sortable sorted={sorted('disk_usage')} onSort={() => onSort('disk_usage')} numeric>
            Disk
          </TH>
          <TH sortable sorted={sorted('db_size')} onSort={() => onSort('db_size')} numeric>
            DB size
          </TH>
          <TH sortable sorted={sorted('db_count')} onSort={() => onSort('db_count')} align="center">
            Databases
          </TH>
          <TH sortable sorted={sorted('email_count')} onSort={() => onSort('email_count')} align="center">
            Mailboxes
          </TH>
          <TH>Status</TH>
        </TR>
      </THead>
      <TBody>
        {accounts.map((account) => {
          const selected = selectedUsernames.has(account.username);
          const dbCount = account.databases?.length ?? 0;
          const emailCount = account.email_accounts?.length ?? 0;
          return (
            <TR key={account.username} clickable selected={selected} onClick={() => onToggle(account)}>
              <TD className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  className={checkboxClasses}
                  checked={selected}
                  onChange={() => onToggle(account)}
                  aria-label={`Select ${account.domain || account.username}`}
                />
              </TD>
              <TDPrimary>
                <div className="flex items-center gap-2">
                  <span className="truncate">{account.domain || <span className="text-slate-400 dark:text-slate-500">no domain</span>}</span>
                  {account.is_wordpress && (
                    <Badge tone="brand" size="sm">
                      WordPress
                    </Badge>
                  )}
                  {account.ssl_enabled && (
                    <Badge tone="success" size="sm">
                      SSL
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-xs font-normal text-slate-500 dark:text-slate-400">{account.username}</div>
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
              <TD numeric>{account.disk_used || <span className="text-slate-400 dark:text-slate-500">—</span>}</TD>
              <TD numeric muted>
                {account.db_size || <span className="text-slate-400 dark:text-slate-500">—</span>}
              </TD>
              <TD align="center">
                <CountPill
                  count={dbCount}
                  icon={<CircleStackIcon />}
                  label={`View ${dbCount} database${dbCount === 1 ? '' : 's'} for ${account.domain || account.username}`}
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
                  label={`View ${emailCount} mailbox${emailCount === 1 ? '' : 'es'} for ${account.domain || account.username}`}
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
