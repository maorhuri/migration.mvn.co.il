import { useMemo, type ReactNode } from 'react';
import { Button, Field, Input, Modal, PANEL_TYPES, PanelMonogram, Select, type SelectOption } from '../ui';
import { useT } from '../../lib/i18n';
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

const AUTH_METHODS: Server['auth_method'][] = ['password', 'ssh_key', 'api_key'];

/** Panel type options with translated labels (t('panel.<type>')). */
export function usePanelTypeOptions(): SelectOption[] {
  const t = useT();
  return useMemo(() => PANEL_TYPES.map((value) => ({ value, label: t(`panel.${value}`) })), [t]);
}

/** Auth method options with translated labels (t('auth.<method>')). */
export function useAuthMethodOptions(): SelectOption[] {
  const t = useT();
  return useMemo(() => AUTH_METHODS.map((value) => ({ value, label: t(`auth.${value}`) })), [t]);
}

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
  return <hr className="border-slate-200 dark:border-white/[0.08]" />;
}

export function ServerFormModal({ open, onClose, mode, form, onChange, onSubmit, sshKeys, saving }: ServerFormModalProps) {
  const t = useT();
  const panelOptions = usePanelTypeOptions();
  const authOptions = useAuthMethodOptions();
  const set = <K extends keyof ServerFormData>(key: K, value: ServerFormData[K]) => onChange({ ...form, [key]: value });
  const isEnhance = form.panel_type === 'enhance';
  const isEdit = mode === 'edit';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? t('servers.form.title.edit') : t('servers.form.title.create')}
      description={isEdit ? t('servers.form.desc.edit') : t('servers.form.desc.create')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="server-form" variant="primary" loading={saving}>
            {isEdit ? t('servers.form.submit.edit') : t('servers.form.submit.create')}
          </Button>
        </>
      }
    >
      <form id="server-form" onSubmit={onSubmit} className="space-y-6">
        <Section title={t('servers.form.section.basics')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('servers.form.name')} required>
              <Input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={t('servers.form.name.placeholder')} required autoFocus />
            </Field>
            <Field label={t('servers.form.panelType')}>
              <Select value={form.panel_type} onChange={(e) => set('panel_type', e.target.value as Server['panel_type'])} options={panelOptions} />
            </Field>
          </div>
        </Section>

        <Divider />

        <Section
          title={isEnhance ? t('servers.form.section.connectionEnhance') : t('servers.form.section.connection')}
          description={isEnhance ? t('servers.form.section.connectionEnhance.hint') : t('servers.form.section.connection.hint')}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('servers.form.host')} required className="sm:col-span-2">
              <Input mono type="text" value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="server.example.com" required />
            </Field>
            <Field label={t('servers.form.port')} hint={t('servers.form.port.hint')}>
              <Input mono type="number" inputMode="numeric" value={form.port} onChange={(e) => set('port', parseInt(e.target.value))} />
            </Field>
          </div>
          <Field label={t('servers.form.username')} required>
            <Input mono type="text" value={form.username} onChange={(e) => set('username', e.target.value)} required autoComplete="off" />
          </Field>
        </Section>

        <Divider />

        <Section title={t('servers.form.section.auth')} description={t('servers.form.section.auth.hint')}>
          <Field label={t('servers.form.authMethod')}>
            <Select value={form.auth_method} onChange={(e) => set('auth_method', e.target.value as Server['auth_method'])} options={authOptions} />
          </Field>

          {form.auth_method === 'password' && (
            <Field label={t('servers.form.password')} hint={isEdit ? t('servers.form.password.keep') : undefined}>
              <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
            </Field>
          )}

          {form.auth_method === 'ssh_key' && (
            <Field label={t('servers.form.sshKey')} hint={sshKeys.length === 0 ? t('servers.form.sshKey.none') : undefined}>
              <Select
                value={form.ssh_key_id}
                onChange={(e) => set('ssh_key_id', e.target.value)}
                placeholder={t('servers.form.sshKey.placeholder')}
                options={sshKeys.map((key) => ({ value: key.id, label: key.name }))}
              />
            </Field>
          )}

          {form.auth_method === 'api_key' && !isEnhance && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('servers.form.apiEndpoint')}>
                <Input mono type="url" value={form.api_endpoint} onChange={(e) => set('api_endpoint', e.target.value)} placeholder="https://api.example.com" />
              </Field>
              <Field label={t('servers.form.apiKey')} hint={isEdit ? t('servers.form.apiKey.keep') : undefined}>
                <Input type="password" value={form.api_key} onChange={(e) => set('api_key', e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
          )}
        </Section>

        {isEnhance && (
          <>
            <Divider />
            <Section title={t('servers.form.section.enhance')} description={t('servers.form.section.enhance.hint')}>
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-500/20 dark:bg-violet-500/10">
                <div className="space-y-4">
                  <Field label={t('servers.form.enhance.url')} required>
                    <Input mono type="url" value={form.api_endpoint} onChange={(e) => set('api_endpoint', e.target.value)} placeholder="https://your-enhance-server.com:8443" required />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('servers.form.enhance.token')} required={!isEdit} hint={isEdit ? t('servers.form.enhance.token.keep') : undefined}>
                      <Input type="password" value={form.api_key} onChange={(e) => set('api_key', e.target.value)} placeholder={t('servers.form.enhance.token.placeholder')} required={!isEdit} autoComplete="new-password" />
                    </Field>
                    <Field label={t('servers.form.enhance.org')} required>
                      <Input mono type="text" value={form.enhance_org_id} onChange={(e) => set('enhance_org_id', e.target.value)} placeholder="org_xxxxx" required />
                    </Field>
                  </div>
                  <p className="flex items-start gap-2 text-xs text-violet-700 dark:text-violet-300">
                    <PanelMonogram panelType="enhance" size="sm" className="mt-px" />
                    <span>{t('servers.form.enhance.note')}</span>
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
