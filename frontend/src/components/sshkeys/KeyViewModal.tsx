import { useEffect, useState } from 'react';
import { StarIcon } from '@heroicons/react/20/solid';
import { StarIcon as StarOutlineIcon } from '@heroicons/react/24/outline';
import { Badge, Button, CodeBlock, KeyValue, Modal, Mono } from '../ui';
import { formatDate } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { SSHKey } from '../../types';
import { FingerprintChip } from './FingerprintChip';

const ALGORITHMS: Record<string, string> = {
  'ssh-ed25519': 'ed25519',
  'ssh-rsa': 'RSA',
  'ssh-dss': 'DSA',
  'ecdsa-sha2-nistp256': 'ECDSA',
  'ecdsa-sha2-nistp384': 'ECDSA',
  'ecdsa-sha2-nistp521': 'ECDSA',
  'sk-ssh-ed25519@openssh.com': 'ed25519-sk',
  'sk-ecdsa-sha2-nistp256@openssh.com': 'ECDSA-sk',
};

/** Key algorithm read from the public key's first token (`ssh-ed25519 AAAA...` -> `ed25519`); null when unknown. */
export function keyAlgorithm(publicKey: string | undefined): string | null {
  const first = publicKey?.trim().split(/\s+/)[0];
  if (!first) return null;
  return ALGORITHMS[first] ?? (/^(ssh|ecdsa|sk)-/.test(first) ? first : null);
}

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
  const t = useT();
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
      title={key?.name ?? t('sshkeys.view.fallbackTitle')}
      description={key?.fingerprint ? <FingerprintChip fingerprint={key.fingerprint} /> : t('sshkeys.view.subtitle')}
      footer={
        <>
          {key && (
            <Button
              variant="secondary"
              leftIcon={isDefault ? <StarIcon className="text-brand-600 dark:text-brand-300" /> : <StarOutlineIcon />}
              loading={pending}
              onClick={() => onToggleDefault(key)}
              className="me-auto"
            >
              {isDefault ? t('sshkeys.view.unsetDefault') : t('sshkeys.view.setDefault')}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            {t('common.done')}
          </Button>
        </>
      }
    >
      {key && (
        <div className="space-y-6">
          <KeyValue
            layout="grid"
            columns={3}
            items={[
              { label: t('sshkeys.view.type'), value: keyAlgorithm(key.public_key), mono: true },
              { label: t('sshkeys.view.created'), value: formatDate(key.created_at) },
              {
                label: t('sshkeys.view.nodes'),
                value: isDefault ? (
                  <Badge tone="brand" size="sm" glow icon={<StarIcon />}>
                    {t('sshkeys.view.default')}
                  </Badge>
                ) : (
                  <span className="font-normal text-slate-500 dark:text-slate-400">{t('sshkeys.view.notDefault')}</span>
                ),
              },
            ]}
          />

          <section className="space-y-2" aria-labelledby={`key-${key.id}-public`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <h3 id={`key-${key.id}-public`} className="eyebrow">
                {t('sshkeys.view.publicKey')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('sshkeys.view.publicKeyHint')}</p>
            </div>
            <CodeBlock title={`${key.name}.pub`} code={key.public_key.trim()} copiedMessage={t('sshkeys.view.publicCopied')} />
          </section>

          <section className="space-y-2" aria-labelledby={`key-${key.id}-install`}>
            <h3 id={`key-${key.id}-install`} className="eyebrow">
              {t('sshkeys.view.install')}
            </h3>
            <CodeBlock language="bash" code={installCommand} copiedMessage={t('sshkeys.view.installCopied')} />
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {t.rich('sshkeys.view.installHint', { path: <Mono className="text-slate-700 dark:text-slate-200">~/.ssh/authorized_keys</Mono> })}
            </p>
          </section>
        </div>
      )}
    </Modal>
  );
}

export default KeyViewModal;
