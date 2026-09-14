import { useRef, type ChangeEvent, type FormEvent } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/16/solid';
import { Button, Field, Input, Modal, Textarea } from '../ui';
import { useT } from '../../lib/i18n';

export interface ImportKeyFormData {
  name: string;
  public_key: string;
  private_key: string;
  passphrase: string;
}

export interface ImportKeyModalProps {
  open: boolean;
  onClose: () => void;
  formData: ImportKeyFormData;
  onChange: (patch: Partial<ImportKeyFormData>) => void;
  onSubmit: (e: FormEvent) => void;
  /** File picker handler for a key field (reads the file into the field). */
  onFileUpload: (field: 'public_key' | 'private_key') => (e: ChangeEvent<HTMLInputElement>) => void;
  loading: boolean;
}

/** Small "Upload file" link-button that wraps a visually hidden file input. */
function FileUploadLabel({ id, accept, onChange }: { id: string; accept?: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void }) {
  const t = useT();
  return (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer items-center gap-1 rounded text-xs font-medium text-brand-700 transition-colors hover:text-brand-600 focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2 focus-within:ring-offset-white dark:text-brand-300 dark:hover:text-brand-200 dark:focus-within:ring-brand-300 dark:focus-within:ring-offset-slate-900"
    >
      <ArrowUpTrayIcon className="h-3.5 w-3.5" aria-hidden="true" />
      {t('sshkeys.import.upload')}
      <input id={id} type="file" accept={accept} onChange={onChange} className="sr-only" />
    </label>
  );
}

/** Import an existing key pair. The public key is optional (derived from the private key). */
export function ImportKeyModal({ open, onClose, formData, onChange, onSubmit, onFileUpload, loading }: ImportKeyModalProps) {
  const t = useT();
  const nameRef = useRef<HTMLInputElement | null>(null);
  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      initialFocus={nameRef}
      size="lg"
      title={t('sshkeys.import.title')}
      description={t('sshkeys.import.description')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="import-ssh-key-form" loading={loading}>
            {t('sshkeys.import.submit')}
          </Button>
        </>
      }
    >
      <form id="import-ssh-key-form" onSubmit={onSubmit} className="space-y-4">
        <Field label={t('sshkeys.import.name')} required>
          <Input
            ref={nameRef}
            value={formData.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="enhance-cluster-eu1"
            autoComplete="off"
            required
          />
        </Field>

        <Field
          label={t('sshkeys.import.privateKey')}
          required
          hint={t('sshkeys.import.privateKeyHint')}
          labelAddon={<FileUploadLabel id="import-private-key-file" onChange={onFileUpload('private_key')} />}
        >
          <Textarea
            mono
            rows={8}
            value={formData.private_key}
            onChange={(e) => onChange({ private_key: e.target.value })}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            spellCheck={false}
            autoComplete="off"
            required
          />
        </Field>

        <Field
          label={t('sshkeys.import.publicKey')}
          hint={t('sshkeys.import.publicKeyHint')}
          labelAddon={
            <span className="inline-flex items-center gap-3">
              <span>{t('common.optional')}</span>
              <FileUploadLabel id="import-public-key-file" accept=".pub" onChange={onFileUpload('public_key')} />
            </span>
          }
        >
          <Textarea
            mono
            rows={3}
            value={formData.public_key}
            onChange={(e) => onChange({ public_key: e.target.value })}
            placeholder="ssh-ed25519 AAAA..."
            spellCheck={false}
            autoComplete="off"
          />
        </Field>

        <Field label={t('sshkeys.import.passphrase')} labelAddon={t('common.optional')} hint={t('sshkeys.import.passphraseHint')}>
          <Input
            type="password"
            value={formData.passphrase}
            onChange={(e) => onChange({ passphrase: e.target.value })}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Field>
      </form>
    </Modal>
  );
}

export default ImportKeyModal;
