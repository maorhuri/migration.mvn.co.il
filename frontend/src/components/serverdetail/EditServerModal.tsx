import type { FormEvent } from 'react';
import { Button, Field, Input, Modal, Select } from '../ui';
import type { Server, SSHKey } from '../../types';

/** Exact shape of the update payload sent to `updateServer` — do not change. */
export interface EditServerForm {
  name: string;
  panel_type: Server['panel_type'];
  host: string;
  port: number;
  username: string;
  auth_method: Server['auth_method'];
  password: string;
  ssh_key_id: string;
  api_endpoint: string;
  api_key: string;
}

export interface EditServerModalProps {
  open: boolean;
  onClose: () => void;
  form: EditServerForm;
  onChange: (next: EditServerForm) => void;
  sshKeys: SSHKey[];
  onSubmit: (e: FormEvent) => void | Promise<void>;
  saving?: boolean;
}

const PANEL_OPTIONS = [
  { value: 'directadmin', label: 'DirectAdmin' },
  { value: 'enhance', label: 'Enhance' },
  { value: 'cpanel', label: 'cPanel' },
  { value: 'cloudpanel', label: 'CloudPanel' },
  { value: 'ftp', label: 'FTP Only' },
  { value: 'wordpress', label: 'WordPress Only' },
];

const AUTH_OPTIONS = [
  { value: 'password', label: 'Password' },
  { value: 'ssh_key', label: 'SSH Key' },
  { value: 'api_key', label: 'API Key' },
];

const FORM_ID = 'edit-server-form';

export function EditServerModal({ open, onClose, form, onChange, sshKeys, onSubmit, saving }: EditServerModalProps) {
  const set = <K extends keyof EditServerForm>(key: K, value: EditServerForm[K]) => onChange({ ...form, [key]: value });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit server"
      description="Connection details used to reach this panel or host."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Server name" required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="My Server" required />
        </Field>

        <Field label="Panel type">
          <Select value={form.panel_type} onChange={(e) => set('panel_type', e.target.value as Server['panel_type'])} options={PANEL_OPTIONS} />
        </Field>

        <Field label="Host" required>
          <Input mono value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="server.example.com" required />
        </Field>

        <Field label="Port">
          <Input mono type="number" inputMode="numeric" value={form.port} onChange={(e) => set('port', parseInt(e.target.value))} />
        </Field>

        <Field label="Username" required>
          <Input mono value={form.username} onChange={(e) => set('username', e.target.value)} required />
        </Field>

        <Field label="Authentication method">
          <Select value={form.auth_method} onChange={(e) => set('auth_method', e.target.value as Server['auth_method'])} options={AUTH_OPTIONS} />
        </Field>

        {form.auth_method === 'password' && (
          <Field label="Password" hint="Leave empty to keep the current password" className="sm:col-span-2">
            <Input type="password" mono autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="••••••••" />
          </Field>
        )}

        {form.auth_method === 'ssh_key' && (
          <Field label="SSH key" className="sm:col-span-2">
            <Select
              value={form.ssh_key_id}
              onChange={(e) => set('ssh_key_id', e.target.value)}
              placeholder="Select SSH key"
              options={sshKeys.map((key) => ({ value: key.id, label: key.name }))}
            />
          </Field>
        )}

        {form.auth_method === 'api_key' && (
          <>
            <Field label="API endpoint" className="sm:col-span-2">
              <Input mono type="url" value={form.api_endpoint} onChange={(e) => set('api_endpoint', e.target.value)} placeholder="https://api.enhance.com" />
            </Field>
            <Field label="API key" hint="Leave empty to keep the current key" className="sm:col-span-2">
              <Input type="password" mono autoComplete="new-password" value={form.api_key} onChange={(e) => set('api_key', e.target.value)} placeholder="••••••••" />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}

export default EditServerModal;
