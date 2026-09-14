import { useRef } from 'react';
import { CircleStackIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { Badge, Button, EmptyState, Modal, Mono } from '../ui';
import { useT } from '../../lib/i18n';
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

/** Technical values (database names, mailboxes) stay LTR in mono, one per hairline row. */
function MonoList({ items }: { items: string[] }) {
  return (
    <ol className="divide-y divide-slate-100 dark:divide-white/[0.06]" role="list">
      {items.map((item, idx) => (
        <li key={`${item}-${idx}`} className="flex items-center gap-3 px-6 py-2.5">
          <span className="w-5 shrink-0 text-end text-2xs tabular text-slate-400 dark:text-slate-500" aria-hidden="true">
            {idx + 1}
          </span>
          <Mono className="text-[13px] text-slate-800 dark:text-slate-200">{item}</Mono>
        </li>
      ))}
    </ol>
  );
}

/** Lists an account's mailboxes (opened from the Mailboxes count in the accounts table). */
export function EmailAccountsModal({ account: current, onClose }: ListModalProps) {
  const t = useT();
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
          {t('serverdetail.modal.mailboxes.title')}
        </span>
      }
      description={
        account ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Mono className="text-[13px]">{account.domain}</Mono>
            <span aria-hidden="true">·</span>
            <span>{t('units.mailboxes', { count: emails.length })}</span>
          </span>
        ) : undefined
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="max-h-80 overflow-y-auto">
        {emails.length === 0 ? <EmptyState size="sm" icon={EnvelopeIcon} title={t('serverdetail.modal.mailboxes.empty')} /> : <MonoList items={emails} />}
      </div>
    </Modal>
  );
}

/** Lists an account's databases (opened from the Databases count in the accounts table). */
export function DatabasesModal({ account: current, onClose }: ListModalProps) {
  const t = useT();
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
          {t('serverdetail.modal.databases.title')}
        </span>
      }
      description={
        account ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Mono className="text-[13px]">{account.domain}</Mono>
            <span aria-hidden="true">·</span>
            <span>{t('units.databases', { count: databases.length })}</span>
          </span>
        ) : undefined
      }
      footer={
        <>
          {account?.db_size && (
            <span className="me-auto flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {t('serverdetail.modal.totalSize')}
              <Badge tone="neutral" size="sm" mono>
                <Mono className="text-2xs">{account.db_size}</Mono>
              </Badge>
            </span>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <div className="max-h-80 overflow-y-auto">
        {databases.length === 0 ? <EmptyState size="sm" icon={CircleStackIcon} title={t('serverdetail.modal.databases.empty')} /> : <MonoList items={databases} />}
      </div>
    </Modal>
  );
}
