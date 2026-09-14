import type { FormEvent } from 'react';
import { Button, Field, Input, Modal, Select } from '../ui';
import { useT } from '../../lib/i18n';
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

const PANEL_VALUES: Server['panel_type'][] = ['directadmin', 'enhance', 'cpanel', 'cloudpanel', 'ftp', 'wordpress'];
const AUTH_VALUES: Server['auth_method'][] = ['password', 'ssh_key', 'api_key'];

const FORM_ID = 'edit-server-form';

export function EditServerModal({ open, onClose, form, onChange, sshKeys, onSubmit, saving }: EditServerModalProps) {
  const t = useT();
  const set = <K extends keyof EditServerForm>(key: K, value: EditServerForm[K]) => onChange({ ...form, [key]: value });

  const panelOptions = PANEL_VALUES.map((value) => ({ value, label: t(`panel.${value}`) }));
  const authOptions = AUTH_VALUES.map((value) => ({ value, label: t(`auth.${value}`) }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('serverdetail.edit.title')}
      description={t('serverdetail.edit.description')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={saving}>
            {t('serverdetail.edit.save')}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('serverdetail.edit.name')} required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={t('serverdetail.edit.namePlaceholder')} required />
        </Field>

        <Field label={t('serverdetail.edit.panel')}>
          <Select value={form.panel_type} onChange={(e) => set('panel_type', e.target.value as Server['panel_type'])} options={panelOptions} />
        </Field>

        <Field label={t('serverdetail.edit.host')} required>
          <Input mono value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="server.example.com" required />
        </Field>

        <Field label={t('serverdetail.edit.port')}>
          <Input mono type="number" inputMode="numeric" value={form.port} onChange={(e) => set('port', parseInt(e.target.value))} />
        </Field>

        <Field label={t('serverdetail.edit.username')} required>
          <Input mono value={form.username} onChange={(e) => set('username', e.target.value)} required />
        </Field>

        <Field label={t('serverdetail.edit.auth')}>
          <Select value={form.auth_method} onChange={(e) => set('auth_method', e.target.value as Server['auth_method'])} options={authOptions} />
        </Field>

        {form.auth_method === 'password' && (
          <Field label={t('serverdetail.edit.password')} hint={t('serverdetail.edit.passwordHint')} className="sm:col-span-2">
            <Input type="password" mono autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="••••••••" />
          </Field>
        )}

        {form.auth_method === 'ssh_key' && (
          <Field label={t('serverdetail.edit.sshKey')} className="sm:col-span-2">
            <Select
              value={form.ssh_key_id}
              onChange={(e) => set('ssh_key_id', e.target.value)}
              placeholder={t('serverdetail.edit.selectKey')}
              options={sshKeys.map((key) => ({ value: key.id, label: key.name }))}
            />
          </Field>
        )}

        {form.auth_method === 'api_key' && (
          <>
            <Field label={t('serverdetail.edit.apiEndpoint')} className="sm:col-span-2">
              <Input mono type="url" value={form.api_endpoint} onChange={(e) => set('api_endpoint', e.target.value)} placeholder="https://api.enhance.com" />
            </Field>
            <Field label={t('serverdetail.edit.apiKey')} hint={t('serverdetail.edit.apiKeyHint')} className="sm:col-span-2">
              <Input type="password" mono autoComplete="new-password" value={form.api_key} onChange={(e) => set('api_key', e.target.value)} placeholder="••••••••" />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}

export default EditServerModal;
