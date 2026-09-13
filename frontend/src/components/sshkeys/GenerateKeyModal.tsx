import { useRef, type FormEvent } from 'react';
import { Button, Field, Input, Modal } from '../ui';

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
  const nameRef = useRef<HTMLInputElement | null>(null);
  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      initialFocus={nameRef}
      title="Generate key"
      description="Creates a new ed25519 key pair on the tool. The private key never leaves the server."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="generate-ssh-key-form" loading={loading}>
            Generate key
          </Button>
        </>
      }
    >
      <form id="generate-ssh-key-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" required hint="A label to recognise the key by, e.g. the cluster it will be installed on.">
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
