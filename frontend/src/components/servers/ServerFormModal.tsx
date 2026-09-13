import type { ReactNode } from 'react';
import { Button, Field, Input, Modal, Select } from '../ui';
import type { Server, SSHKey } from '../../types';

/** Shape of the create/update payload — matches the original page exactly. */
export interface ServerFormData {
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
  // Enhance specific fields
  enhance_org_id: string;
}

export const EMPTY_SERVER_FORM: ServerFormData = {
  name: '',
  panel_type: 'directadmin',
  host: '',
  port: 22,
  username: 'root',
  auth_method: 'password',
  password: '',
  ssh_key_id: '',
  api_endpoint: '',
  api_key: '',
  enhance_org_id: '',
};

export const PANEL_TYPE_OPTIONS: { value: Server['panel_type']; label: string }[] = [
  { value: 'directadmin', label: 'DirectAdmin' },
  { value: 'enhance', label: 'Enhance' },
  { value: 'cpanel', label: 'cPanel' },
  { value: 'cloudpanel', label: 'CloudPanel' },
  { value: 'ftp', label: 'FTP Only' },
  { value: 'wordpress', label: 'WordPress Only' },
];

const AUTH_METHOD_OPTIONS: { value: Server['auth_method']; label: string }[] = [
  { value: 'password', label: 'Password' },
  { value: 'ssh_key', label: 'SSH Key' },
  { value: 'api_key', label: 'API Key' },
];

export interface ServerFormModalProps {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  form: ServerFormData;
  onChange: (next: ServerFormData) => void;
  onSubmit: (e: React.FormEvent) => void;
  sshKeys: SSHKey[];
  saving: boolean;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Divider() {
  return <hr className="border-slate-200 dark:border-slate-800" />;
}

export function ServerFormModal({ open, onClose, mode, form, onChange, onSubmit, sshKeys, saving }: ServerFormModalProps) {
  const set = <K extends keyof ServerFormData>(key: K, value: ServerFormData[K]) => onChange({ ...form, [key]: value });
  const isEnhance = form.panel_type === 'enhance';
  const isEdit = mode === 'edit';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Edit server' : 'Add server'}
      description={isEdit ? 'Update connection details for this server.' : 'Connect a panel or SSH host as a migration source or target.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="server-form" variant="primary" loading={saving}>
            {isEdit ? 'Save changes' : 'Add server'}
          </Button>
        </>
      }
    >
      <form id="server-form" onSubmit={onSubmit} className="space-y-6">
        <Section title="Basics">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Server name" required>
              <Input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="My Server" required autoFocus />
            </Field>
            <Field label="Panel type">
              <Select value={form.panel_type} onChange={(e) => set('panel_type', e.target.value as Server['panel_type'])} options={PANEL_TYPE_OPTIONS} />
            </Field>
          </div>
        </Section>

        <Divider />

        <Section
          title={isEnhance ? 'Connection (SSH for rsync)' : 'Connection'}
          description={isEnhance ? 'SSH access to the node used for file transfer.' : 'SSH host used to read and write account data.'}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="SSH host" required className="sm:col-span-2">
              <Input mono type="text" value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="server.example.com" required />
            </Field>
            <Field label="SSH port" hint="Default 22">
              <Input mono type="number" inputMode="numeric" value={form.port} onChange={(e) => set('port', parseInt(e.target.value))} />
            </Field>
          </div>
          <Field label="Username" required>
            <Input mono type="text" value={form.username} onChange={(e) => set('username', e.target.value)} required autoComplete="off" />
          </Field>
        </Section>

        <Divider />

        <Section title="Authentication" description="How the tool authenticates over SSH.">
          <Field label="SSH authentication method">
            <Select value={form.auth_method} onChange={(e) => set('auth_method', e.target.value as Server['auth_method'])} options={AUTH_METHOD_OPTIONS} />
          </Field>

          {form.auth_method === 'password' && (
            <Field label="Password" hint={isEdit ? 'Leave blank to keep the current password.' : undefined}>
              <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
            </Field>
          )}

          {form.auth_method === 'ssh_key' && (
            <Field label="SSH key" hint={sshKeys.length === 0 ? 'No keys yet — add one under SSH Keys.' : undefined}>
              <Select
                value={form.ssh_key_id}
                onChange={(e) => set('ssh_key_id', e.target.value)}
                placeholder="Select SSH key"
                options={sshKeys.map((key) => ({ value: key.id, label: key.name }))}
              />
            </Field>
          )}

          {form.auth_method === 'api_key' && !isEnhance && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="API endpoint">
                <Input mono type="url" value={form.api_endpoint} onChange={(e) => set('api_endpoint', e.target.value)} placeholder="https://api.example.com" />
              </Field>
              <Field label="API key" hint={isEdit ? 'Leave blank to keep the current key.' : undefined}>
                <Input type="password" value={form.api_key} onChange={(e) => set('api_key', e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
          )}
        </Section>

        {isEnhance && (
          <>
            <Divider />
            <Section title="Enhance settings" description="Control-panel API used to discover the cluster and create accounts.">
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-500/20 dark:bg-violet-500/10">
                <div className="space-y-4">
                  <Field label="API URL" required>
                    <Input mono type="url" value={form.api_endpoint} onChange={(e) => set('api_endpoint', e.target.value)} placeholder="https://your-enhance-server.com:8443" required />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="API token" required={!isEdit} hint={isEdit ? 'Leave blank to keep the current token.' : undefined}>
                      <Input type="password" value={form.api_key} onChange={(e) => set('api_key', e.target.value)} placeholder="Your API token" required={!isEdit} autoComplete="new-password" />
                    </Field>
                    <Field label="Organization ID" required>
                      <Input mono type="text" value={form.enhance_org_id} onChange={(e) => set('enhance_org_id', e.target.value)} placeholder="org_xxxxx" required />
                    </Field>
                  </div>
                  <p className="text-xs text-violet-700 dark:text-violet-300">
                    If this is a cluster, the system will automatically detect all servers and let you choose the target during migration.
                  </p>
                </div>
              </div>
            </Section>
          </>
        )}
      </form>
    </Modal>
  );
}

export default ServerFormModal;
