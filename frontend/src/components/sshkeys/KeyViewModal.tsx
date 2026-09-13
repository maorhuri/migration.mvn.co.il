import { useEffect, useState } from 'react';
import { StarIcon } from '@heroicons/react/20/solid';
import { StarIcon as StarOutlineIcon } from '@heroicons/react/24/outline';
import { Badge, Button, CodeBlock, KeyValue, Modal } from '../ui';
import { formatDate } from '../../lib/format';
import type { SSHKey } from '../../types';

export interface KeyViewModalProps {
  /** Key to show; `null` closes the modal. */
  sshKey: SSHKey | null;
  onClose: () => void;
  /** Toggle the default flag for the shown key. */
  onToggleDefault: (key: SSHKey) => void | Promise<void>;
  /** Id of the key whose default flag is currently being changed. */
  pendingDefaultId: string | null;
}

/** Fallback install command for keys stored before the backend returned one. */
function fallbackInstallCommand(publicKey: string): string {
  return `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${publicKey.trim()}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
}

/**
 * Read-only details of a key: public key and the install command, both copyable.
 * Keeps the last shown key while the close transition runs.
 */
export function KeyViewModal({ sshKey, onClose, onToggleDefault, pendingDefaultId }: KeyViewModalProps) {
  const [shown, setShown] = useState<SSHKey | null>(sshKey);
  useEffect(() => {
    if (sshKey) setShown(sshKey);
  }, [sshKey]);

  const key = sshKey ?? shown;
  const open = sshKey !== null;
  const isDefault = !!key?.is_default;
  const pending = !!key && pendingDefaultId === key.id;
  const installCommand = key?.install_command || (key ? fallbackInstallCommand(key.public_key) : '');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={key?.name ?? 'SSH key'}
      description={key?.fingerprint ? <span className="font-mono text-xs">{key.fingerprint}</span> : 'Public key and install command'}
      footer={
        <>
          {key && (
            <Button
              variant="secondary"
              leftIcon={isDefault ? <StarIcon /> : <StarOutlineIcon />}
              loading={pending}
              onClick={() => onToggleDefault(key)}
              className="mr-auto"
            >
              {isDefault ? 'Unset default' : 'Set as default'}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {key && (
        <div className="space-y-5">
          <KeyValue
            layout="grid"
            columns={3}
            items={[
              { label: 'Fingerprint', value: key.fingerprint, mono: true, span: true },
              { label: 'Created', value: formatDate(key.created_at) },
              {
                label: 'Cluster nodes',
                value: isDefault ? (
                  <Badge tone="brand" size="sm" icon={<StarIcon />}>
                    Default
                  </Badge>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">Not the default</span>
                ),
              },
            ]}
          />

          <section className="space-y-2" aria-labelledby={`key-${key.id}-public`}>
            <h3 id={`key-${key.id}-public`} className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Public key
            </h3>
            <CodeBlock title={`${key.name}.pub`} code={key.public_key.trim()} copiedMessage="Public key copied" />
          </section>

          <section className="space-y-2" aria-labelledby={`key-${key.id}-install`}>
            <h3 id={`key-${key.id}-install`} className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Install command
            </h3>
            <CodeBlock title="Install on a node" language="bash" code={installCommand} copiedMessage="Install command copied" />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Run as root on every server or cluster node that should accept this key. It appends the public key to{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-900 dark:bg-slate-800 dark:text-slate-100">~/.ssh/authorized_keys</code>{' '}
              and leaves existing keys untouched.
            </p>
          </section>
        </div>
      )}
    </Modal>
  );
}

export default KeyViewModal;
