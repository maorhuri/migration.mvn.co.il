import { useEffect, useState } from 'react';
import { CircleStackIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { Button, EmptyState, Modal, Mono } from '../ui';
import { useT } from '../../lib/i18n';
import type { Account } from '../../types';

interface AccountListModalProps {
  account: Account | null;
  onClose: () => void;
  kind: 'emails' | 'databases';
}

const KIND_META = {
  emails: {
    titleKey: 'newmigration.modal.mailboxes',
    icon: EnvelopeIcon,
    emptyKey: 'newmigration.modal.noMailboxes',
    unitKey: 'units.mailboxes',
    pick: (a: Account) => a.email_accounts ?? [],
  },
  databases: {
    titleKey: 'newmigration.modal.databases',
    icon: CircleStackIcon,
    emptyKey: 'newmigration.modal.noDatabases',
    unitKey: 'units.databases',
    pick: (a: Account) => a.databases ?? [],
  },
} as const;

/**
 * Read-only list of an account's mailboxes or databases. Keeps the last account
 * mounted while the modal fades out so the content does not flash empty.
 */
function AccountListModal({ account, onClose, kind }: AccountListModalProps) {
  const t = useT();
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
      title={t(meta.titleKey)}
      description={
        shown ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Mono className="text-[13px] text-slate-700 dark:text-slate-300">{shown.domain || shown.username}</Mono>
            <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
              ·
            </span>
            <span>{t(meta.unitKey, { count: items.length })}</span>
          </span>
        ) : undefined
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {items.length === 0 ? (
        <EmptyState size="sm" icon={Icon} title={t(meta.emptyKey)} />
      ) : (
        <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto dark:divide-white/[0.06]">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex items-center gap-3 px-5 py-2.5 sm:px-6">
              <Icon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
              <Mono className="min-w-0 text-[13px] text-slate-700 dark:text-slate-300">{item}</Mono>
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
