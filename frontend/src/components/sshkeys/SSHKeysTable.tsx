import { EyeIcon, StarIcon, TrashIcon } from '@heroicons/react/20/solid';
import { StarIcon as StarOutlineIcon } from '@heroicons/react/24/outline';
import { Badge, IconButton, TBody, TD, TDPrimary, TH, THead, TR, Table } from '../ui';
import { formatDate, formatRelativeTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { SSHKey } from '../../types';
import { FingerprintChip } from './FingerprintChip';

export interface SSHKeysTableProps {
  keys: SSHKey[];
  onView: (key: SSHKey) => void;
  onToggleDefault: (key: SSHKey) => void;
  onDelete: (key: SSHKey) => void;
  /** Id of the key whose default flag is being changed. */
  pendingDefaultId: string | null;
}

/** Dense list of stored keys with row actions. Render inside `<Card flush>`. */
export function SSHKeysTable({ keys, onView, onToggleDefault, onDelete, pendingDefaultId }: SSHKeysTableProps) {
  const t = useT();
  return (
    <Table bare stickyHeader maxHeight="70vh">
      <THead>
        <TR hoverable={false}>
          <TH>{t('sshkeys.table.name')}</TH>
          <TH>{t('sshkeys.table.fingerprint')}</TH>
          <TH>{t('sshkeys.table.default')}</TH>
          <TH>{t('sshkeys.table.created')}</TH>
          <TH align="end">
            <span className="sr-only">{t('table.actions')}</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {keys.map((key) => {
          const isDefault = !!key.is_default;
          const pending = pendingDefaultId === key.id;
          return (
            <TR key={key.id} className="group">
              <TDPrimary className="whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => onView(key)}
                  className="-mx-1.5 -my-1 rounded-md px-1.5 py-1 text-start transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:text-brand-300 dark:focus-visible:ring-brand-300"
                >
                  {key.name}
                </button>
              </TDPrimary>
              <TD className="max-w-[440px]">
                {key.fingerprint ? (
                  <FingerprintChip fingerprint={key.fingerprint} prefix="wide" />
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">{t('common.notAvailable')}</span>
                )}
              </TD>
              <TD>
                {isDefault ? (
                  <Badge tone="brand" size="sm" glow icon={<StarIcon />}>
                    {t('sshkeys.table.defaultBadge')}
                  </Badge>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">{t('common.notAvailable')}</span>
                )}
              </TD>
              <TD muted className="whitespace-nowrap" title={formatDate(key.created_at)}>
                {formatRelativeTime(key.created_at)}
              </TD>
              <TD align="end" className="whitespace-nowrap">
                <div className="inline-flex items-center gap-0.5 opacity-70 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <IconButton
                    aria-label={t('sshkeys.table.viewX', { name: key.name })}
                    title={t('sshkeys.table.view')}
                    icon={<EyeIcon />}
                    size="sm"
                    tone="brand"
                    onClick={() => onView(key)}
                  />
                  <IconButton
                    aria-label={isDefault ? t('sshkeys.table.unsetDefaultX', { name: key.name }) : t('sshkeys.table.setDefaultX', { name: key.name })}
                    title={isDefault ? t('sshkeys.table.unsetDefault') : t('sshkeys.table.setDefault')}
                    aria-pressed={isDefault}
                    icon={isDefault ? <StarIcon className="text-brand-600 dark:text-brand-300" /> : <StarOutlineIcon />}
                    size="sm"
                    tone="brand"
                    loading={pending}
                    onClick={() => onToggleDefault(key)}
                  />
                  <IconButton
                    aria-label={t('sshkeys.table.deleteX', { name: key.name })}
                    title={t('sshkeys.table.delete')}
                    icon={<TrashIcon />}
                    size="sm"
                    tone="danger"
                    onClick={() => onDelete(key)}
                  />
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

export default SSHKeysTable;
