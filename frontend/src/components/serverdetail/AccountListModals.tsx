import { useRef } from 'react';
import { CircleStackIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { Badge, Button, EmptyState, Modal } from '../ui';
import type { Account } from '../../types';

interface ListModalProps {
  account: Account | null;
  onClose: () => void;
}

/** Keeps the last opened account so the modal body stays populated during the close transition. */
function useLastAccount(account: Account | null): Account | null {
  const last = useRef<Account | null>(null);
  if (account) last.current = account;
  return account ?? last.current;
}

function MonoList({ items }: { items: string[] }) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
      {items.map((item, idx) => (
        <li key={`${item}-${idx}`} className="px-5 py-2 font-mono text-[13px] text-slate-700 dark:text-slate-300">
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Lists an account's email addresses (opened from the Emails count in the accounts table). */
export function EmailAccountsModal({ account: current, onClose }: ListModalProps) {
  const account = useLastAccount(current);
  const emails = account?.email_accounts ?? [];
  return (
    <Modal
      open={current !== null}
      onClose={onClose}
      size="sm"
      flush
      title={
        <span className="flex items-center gap-2">
          <EnvelopeIcon className="h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          Email accounts
        </span>
      }
      description={
        account ? (
          <>
            <span className="font-mono">{account.domain}</span> · {emails.length} {emails.length === 1 ? 'address' : 'addresses'}
          </>
        ) : undefined
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="max-h-80 overflow-y-auto">
        {emails.length === 0 ? <EmptyState size="sm" icon={EnvelopeIcon} title="No email accounts" /> : <MonoList items={emails} />}
      </div>
    </Modal>
  );
}

/** Lists an account's databases (opened from the Databases count in the accounts table). */
export function DatabasesModal({ account: current, onClose }: ListModalProps) {
  const account = useLastAccount(current);
  const databases = account?.databases ?? [];
  return (
    <Modal
      open={current !== null}
      onClose={onClose}
      size="sm"
      flush
      title={
        <span className="flex items-center gap-2">
          <CircleStackIcon className="h-5 w-5 text-violet-600 dark:text-violet-400" aria-hidden="true" />
          Databases
        </span>
      }
      description={
        account ? (
          <>
            <span className="font-mono">{account.domain}</span> · {databases.length} {databases.length === 1 ? 'database' : 'databases'}
          </>
        ) : undefined
      }
      footer={
        <>
          {account?.db_size && (
            <span className="mr-auto flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              Total size
              <Badge tone="neutral" size="sm" mono>
                {account.db_size}
              </Badge>
            </span>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="max-h-80 overflow-y-auto">
        {databases.length === 0 ? <EmptyState size="sm" icon={CircleStackIcon} title="No databases" /> : <MonoList items={databases} />}
      </div>
    </Modal>
  );
}
