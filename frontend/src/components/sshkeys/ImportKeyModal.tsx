import { useRef, type ChangeEvent, type FormEvent } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/16/solid';
import { Button, Field, Input, Modal, Textarea } from '../ui';

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
  return (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer items-center gap-1 rounded text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2 focus-within:ring-offset-white dark:text-indigo-400 dark:hover:text-indigo-300 dark:focus-within:ring-offset-slate-900"
    >
      <ArrowUpTrayIcon className="h-3.5 w-3.5" aria-hidden="true" />
      Upload file
      <input id={id} type="file" accept={accept} onChange={onChange} className="sr-only" />
    </label>
  );
}

/** Import an existing key pair. The public key is optional (derived from the private key). */
export function ImportKeyModal({ open, onClose, formData, onChange, onSubmit, onFileUpload, loading }: ImportKeyModalProps) {
  const nameRef = useRef<HTMLInputElement | null>(null);
  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      initialFocus={nameRef}
      size="lg"
      title="Import key"
      description="Paste or upload an existing private key. Keys are stored encrypted on the tool."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="import-ssh-key-form" loading={loading}>
            Import key
          </Button>
        </>
      }
    >
      <form id="import-ssh-key-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" required>
          <Input
            ref={nameRef}
            value={formData.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="My SSH key"
            autoComplete="off"
            required
          />
        </Field>

        <Field
          label="Private key"
          required
          hint="PEM or OpenSSH format (-----BEGIN OPENSSH PRIVATE KEY-----)."
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
          label="Public key"
          hint="Optional — derived from the private key when left empty."
          labelAddon={
            <span className="inline-flex items-center gap-3">
              <span>Optional</span>
              <FileUploadLabel id="import-public-key-file" accept=".pub" onChange={onFileUpload('public_key')} />
            </span>
          }
        >
          <Textarea
            mono
            rows={3}
            value={formData.public_key}
            onChange={(e) => onChange({ public_key: e.target.value })}
            placeholder="ssh-ed25519 AAAA…"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>

        <Field label="Passphrase" labelAddon="Optional" hint="Leave empty if the private key is not encrypted.">
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
