import { EyeIcon, StarIcon, TrashIcon } from '@heroicons/react/20/solid';
import { StarIcon as StarOutlineIcon } from '@heroicons/react/24/outline';
import { Badge, IconButton, TBody, TD, TDPrimary, TH, THead, TR, Table } from '../ui';
import { formatDate, formatRelativeTime } from '../../lib/format';
import type { SSHKey } from '../../types';

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
  return (
    <Table bare stickyHeader maxHeight="70vh">
      <THead>
        <TR hoverable={false}>
          <TH>Name</TH>
          <TH>Fingerprint</TH>
          <TH>Cluster nodes</TH>
          <TH>Created</TH>
          <TH align="right">
            <span className="sr-only">Actions</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {keys.map((key) => {
          const isDefault = !!key.is_default;
          const pending = pendingDefaultId === key.id;
          return (
            <TR key={key.id}>
              <TDPrimary>
                <button
                  type="button"
                  onClick={() => onView(key)}
                  className="rounded text-left transition-colors hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:text-indigo-400"
                >
                  {key.name}
                </button>
              </TDPrimary>
              <TD mono className="max-w-[320px]">
                {key.fingerprint ? (
                  <span className="block truncate" title={key.fingerprint}>
                    {key.fingerprint}
                  </span>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">—</span>
                )}
              </TD>
              <TD>
                {isDefault ? (
                  <Badge tone="brand" size="sm" icon={<StarIcon />}>
                    Default
                  </Badge>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">—</span>
                )}
              </TD>
              <TD muted className="whitespace-nowrap" title={formatDate(key.created_at)}>
                {formatRelativeTime(key.created_at)}
              </TD>
              <TD align="right" className="whitespace-nowrap">
                <div className="inline-flex items-center gap-0.5">
                  <IconButton aria-label={`View ${key.name}`} title="View" icon={<EyeIcon />} size="sm" tone="brand" onClick={() => onView(key)} />
                  <IconButton
                    aria-label={isDefault ? `Unset ${key.name} as default` : `Set ${key.name} as default`}
                    title={isDefault ? 'Unset default' : 'Set as default'}
                    icon={isDefault ? <StarIcon className="text-indigo-500 dark:text-indigo-400" /> : <StarOutlineIcon />}
                    size="sm"
                    tone="brand"
                    loading={pending}
                    onClick={() => onToggleDefault(key)}
                  />
                  <IconButton aria-label={`Delete ${key.name}`} title="Delete" icon={<TrashIcon />} size="sm" tone="danger" onClick={() => onDelete(key)} />
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
