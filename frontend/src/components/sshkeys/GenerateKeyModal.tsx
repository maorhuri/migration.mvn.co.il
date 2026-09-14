import { useRef, type FormEvent } from 'react';
import { Button, Field, Input, Modal } from '../ui';
import { useT } from '../../lib/i18n';

export interface GenerateKeyModalProps {
  open: boolean;
  onClose: () => void;
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
}

/** Name-only form; the ed25519 key pair is generated server-side. */
export function GenerateKeyModal({ open, onClose, name, onNameChange, onSubmit, loading }: GenerateKeyModalProps) {
  const t = useT();
  const nameRef = useRef<HTMLInputElement | null>(null);
  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      initialFocus={nameRef}
      title={t('sshkeys.generate.title')}
      description={t('sshkeys.generate.description')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="generate-ssh-key-form" loading={loading}>
            {t('sshkeys.generate.submit')}
          </Button>
        </>
      }
    >
      <form id="generate-ssh-key-form" onSubmit={onSubmit} className="space-y-4">
        <Field label={t('sshkeys.generate.name')} required hint={t('sshkeys.generate.nameHint')}>
          <Input
            ref={nameRef}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="enhance-cluster-eu1"
            autoComplete="off"
            required
          />
        </Field>
      </form>
    </Modal>
  );
}

export default GenerateKeyModal;
