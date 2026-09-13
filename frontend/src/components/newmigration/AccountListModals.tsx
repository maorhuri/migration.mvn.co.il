import { useEffect, useState } from 'react';
import { CircleStackIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { Button, EmptyState, Modal } from '../ui';
import type { Account } from '../../types';

interface AccountListModalProps {
  account: Account | null;
  onClose: () => void;
  kind: 'emails' | 'databases';
}

const KIND_META = {
  emails: {
    title: 'Mailboxes',
    icon: EnvelopeIcon,
    empty: 'No mailboxes on this account',
    pick: (a: Account) => a.email_accounts ?? [],
    noun: (n: number) => `${n} mailbox${n === 1 ? '' : 'es'}`,
  },
  databases: {
    title: 'Databases',
    icon: CircleStackIcon,
    empty: 'No databases on this account',
    pick: (a: Account) => a.databases ?? [],
    noun: (n: number) => `${n} database${n === 1 ? '' : 's'}`,
  },
} as const;

/**
 * Read-only list of an account's mailboxes or databases. Keeps the last account
 * mounted while the modal fades out so the content does not flash empty.
 */
function AccountListModal({ account, onClose, kind }: AccountListModalProps) {
  const [shown, setShown] = useState<Account | null>(account);
  useEffect(() => {
    if (account) setShown(account);
  }, [account]);

  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const items = shown ? meta.pick(shown) : [];

  return (
    <Modal
      open={!!account}
      onClose={onClose}
      size="md"
      flush
      title={meta.title}
      description={
        shown ? (
          <>
            <span className="font-mono text-[13px] text-slate-700 dark:text-slate-300">{shown.domain || shown.username}</span>
            <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
            {meta.noun(items.length)}
          </>
        ) : undefined
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {items.length === 0 ? (
        <EmptyState size="sm" icon={Icon} title={meta.empty} />
      ) : (
        <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex items-center gap-3 px-5 py-2.5 sm:px-6">
              <Icon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
              <span className="min-w-0 truncate font-mono text-[13px] text-slate-700 dark:text-slate-300">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function EmailAccountsModal(props: Omit<AccountListModalProps, 'kind'>) {
  return <AccountListModal {...props} kind="emails" />;
}

export function DatabasesModal(props: Omit<AccountListModalProps, 'kind'>) {
  return <AccountListModal {...props} kind="databases" />;
}
