import { useMemo, useState, type ComponentType, type FormEvent, type ReactNode, type SVGProps } from 'react';
import { CheckIcon } from '@heroicons/react/16/solid';
import { FolderOpenIcon, GlobeAltIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import { Button, Checkbox, Field, Input, Modal, PANEL_TYPES, PanelMonogram, SERVER_PANEL_TYPES, Select, surfaceClasses, type SelectOption } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { hostFromUrl, isValidSiteUrl, normalizeSiteUrl, serverDocroot, serverFtps, serverSiteUrl } from '../../lib/agentless';
import type { ServerPayload } from '../../api/client';
import type { Server, SSHKey } from '../../types';

/** The three kinds offered by the add-target form. `server` = a control panel with root (today's form). */
export type ServerKind = 'server' | 'ftp' | 'wordpress';

/** Everything the form edits. `buildServerPayload` turns it into the create/update body per kind. */
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
  // Agentless sources (ftp / wordpress): stored under `metadata`
  site_url: string;
  ftps: boolean;
  docroot: string;
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
  site_url: '',
  ftps: false,
  docroot: '',
};

/** Field values a kind starts with when picked in the form. */
const KIND_DEFAULTS: Record<ServerKind, Pick<ServerFormData, 'panel_type' | 'port' | 'username' | 'auth_method'>> = {
  server: { panel_type: 'directadmin', port: 22, username: 'root', auth_method: 'password' },
  ftp: { panel_type: 'ftp', port: 21, username: '', auth_method: 'password' },
  wordpress: { panel_type: 'wordpress', port: 443, username: '', auth_method: 'password' },
};

const AUTH_METHODS: Server['auth_method'][] = ['password', 'ssh_key', 'api_key'];

/** Which kind a stored panel type belongs to. */
export function kindOf(panelType: string | null | undefined): ServerKind {
  if (panelType === 'ftp') return 'ftp';
  if (panelType === 'wordpress') return 'wordpress';
  return 'server';
}

/** Form values for editing an existing server (secrets blank = keep current). */
export function serverToForm(server: Server): ServerFormData {
  const metaOrg = server.metadata?.enhance_org_id;
  return {
    name: server.name,
    panel_type: server.panel_type,
    host: server.host,
    port: server.port,
    username: server.username,
    auth_method: server.auth_method,
    password: '',
    ssh_key_id: server.ssh_key_id ?? '',
    api_endpoint: server.api_endpoint ?? '',
    api_key: '',
    enhance_org_id: server.enhance_org_id ?? (typeof metaOrg === 'string' ? metaOrg : ''),
    site_url: serverSiteUrl(server),
    ftps: serverFtps(server),
    docroot: serverDocroot(server),
  };
}

/**
 * The exact create / update body per kind:
 * - server: today's fields, unchanged.
 * - ftp: host/port/username/password + metadata { site_url, ftps, docroot }.
 * - wordpress: host derived from the site URL, port 443, wp-admin user/password + metadata { site_url }.
 */
export function buildServerPayload(form: ServerFormData): ServerPayload {
  const kind = kindOf(form.panel_type);
  if (kind === 'ftp') {
    const site_url = normalizeSiteUrl(form.site_url);
    return {
      name: form.name,
      panel_type: 'ftp',
      host: form.host.trim(),
      port: Number.isFinite(form.port) && form.port > 0 ? form.port : 21,
      username: form.username.trim(),
      auth_method: 'password',
      password: form.password,
      metadata: { site_url, ftps: !!form.ftps, docroot: form.docroot.trim() },
    };
  }
  if (kind === 'wordpress') {
    const site_url = normalizeSiteUrl(form.site_url);
    return {
      name: form.name,
      panel_type: 'wordpress',
      host: hostFromUrl(site_url),
      port: 443,
      username: form.username.trim(),
      auth_method: 'password',
      password: form.password,
      metadata: { site_url },
    };
  }
  return {
    name: form.name,
    panel_type: form.panel_type,
    host: form.host,
    port: form.port,
    username: form.username,
    auth_method: form.auth_method,
    password: form.password,
    ssh_key_id: form.ssh_key_id,
    api_endpoint: form.api_endpoint,
    api_key: form.api_key,
    enhance_org_id: form.enhance_org_id,
  };
}

/** Panel type options with translated labels (t('panel.<type>')) — every known type, for filters. */
export function usePanelTypeOptions(): SelectOption[] {
  const t = useT();
  return useMemo(() => PANEL_TYPES.map((value) => ({ value, label: t(`panel.${value}`) })), [t]);
}

/** Panel types the "Server" kind can be: DirectAdmin, Enhance, cPanel. */
export function useServerPanelTypeOptions(): SelectOption[] {
  const t = useT();
  return useMemo(() => SERVER_PANEL_TYPES.map((value) => ({ value, label: t(`panel.${value}`) })), [t]);
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
  /** Called only when the form validates (the event is already prevented). */
  onSubmit: (e: FormEvent) => void;
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

interface KindCardProps {
  kind: ServerKind;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  selected: boolean;
  onSelect: (kind: ServerKind) => void;
}

/** One of the three selectable kind tiles (icon, title, one-line description). */
function KindCard({ kind, icon: Icon, selected, onSelect }: KindCardProps) {
  const t = useT();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(kind)}
      className={cn(
        surfaceClasses,
        'relative flex w-full items-start gap-3 p-3.5 text-start transition-[box-shadow,border-color,background-color] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-brand-300 dark:focus-visible:ring-offset-slate-900',
        selected
          ? 'border-brand-500 bg-brand-50/40 ring-2 ring-brand-500/25 dark:border-brand-400 dark:bg-brand-500/[0.06] dark:ring-brand-400/25'
          : 'hover:border-slate-300 hover:bg-slate-50 dark:hover:border-white/[0.16] dark:hover:bg-white/[0.03]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          selected ? 'bg-brand-700 text-white dark:bg-brand-600' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400',
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{t(`servers.form.kind.${kind}.title`)}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t(`servers.form.kind.${kind}.desc`)}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'absolute end-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full transition-[opacity,transform] duration-150',
          selected ? 'bg-brand-700 text-white opacity-100 dark:bg-brand-600' : 'scale-75 opacity-0',
        )}
      >
        <CheckIcon className="h-3 w-3" />
      </span>
    </button>
  );
}

const KIND_ICONS: Record<ServerKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  server: ServerStackIcon,
  ftp: FolderOpenIcon,
  wordpress: GlobeAltIcon,
};
const KINDS: ServerKind[] = ['server', 'ftp', 'wordpress'];

/**
 * Add / edit target. Starts with the kind (Server / FTP / WordPress); the fields below follow it.
 * The Server kind is the original panel form, unchanged.
 */
export function ServerFormModal({ open, onClose, mode, form, onChange, onSubmit, sshKeys, saving }: ServerFormModalProps) {
  const t = useT();
  const panelOptions = useServerPanelTypeOptions();
  const authOptions = useAuthMethodOptions();
  const [siteUrlError, setSiteUrlError] = useState<string | null>(null);
  const set = <K extends keyof ServerFormData>(key: K, value: ServerFormData[K]) => onChange({ ...form, [key]: value });
  const kind = kindOf(form.panel_type);
  const isEnhance = form.panel_type === 'enhance';
  const isEdit = mode === 'edit';
  const agentless = kind !== 'server';

  const selectKind = (next: ServerKind) => {
    if (next === kind) return;
    setSiteUrlError(null);
    onChange({ ...form, ...KIND_DEFAULTS[next] });
  };

  const setSiteUrl = (value: string) => {
    if (siteUrlError) setSiteUrlError(null);
    set('site_url', value);
  };

  // Normalize on blur so "example.com" becomes "https://example.com" in front of the operator.
  const blurSiteUrl = () => {
    if (form.site_url.trim() && isValidSiteUrl(form.site_url)) set('site_url', normalizeSiteUrl(form.site_url));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (agentless && !isValidSiteUrl(form.site_url)) {
      setSiteUrlError(t('servers.form.siteUrl.invalid'));
      return;
    }
    onSubmit(e);
  };

  const title = isEdit ? t(`servers.form.title.edit.${kind}`) : t('servers.form.title.create');
  const description = isEdit ? t('servers.form.desc.edit') : t('servers.form.desc.create');

  const siteUrlField = (
    <Field label={t('servers.form.siteUrl')} required hint={siteUrlError ? undefined : t('servers.form.siteUrl.hint')} error={siteUrlError}>
      <Input
        mono
        type="text"
        inputMode="url"
        value={form.site_url}
        onChange={(e) => setSiteUrl(e.target.value)}
        onBlur={blurSiteUrl}
        placeholder="https://example.com"
        required
        autoComplete="off"
      />
    </Field>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={title}
      description={description}
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
      <form id="server-form" onSubmit={handleSubmit} className="space-y-6">
        {!isEdit && (
          <div role="radiogroup" aria-label={t('servers.form.kind.label')} className="grid gap-3 sm:grid-cols-3">
            {KINDS.map((k) => (
              <KindCard key={k} kind={k} icon={KIND_ICONS[k]} selected={kind === k} onSelect={selectKind} />
            ))}
          </div>
        )}

        {kind === 'server' && (
          <>
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
          </>
        )}

        {kind === 'ftp' && (
          <>
            <Section title={t('servers.form.section.site')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('servers.form.name')} required>
                  <Input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={t('servers.form.name.placeholder.ftp')} required autoFocus />
                </Field>
                {siteUrlField}
              </div>
            </Section>

            <Divider />

            <Section title={t('servers.form.section.ftp')} description={t('servers.form.section.ftp.hint')}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('servers.form.ftp.host')} required className="sm:col-span-2">
                  <Input mono type="text" value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="ftp.example.com" required autoComplete="off" />
                </Field>
                <Field label={t('servers.form.ftp.port')} hint={t('servers.form.ftp.port.hint')}>
                  <Input mono type="number" inputMode="numeric" min={1} max={65535} value={form.port} onChange={(e) => set('port', parseInt(e.target.value))} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('servers.form.ftp.username')} required>
                  <Input mono type="text" value={form.username} onChange={(e) => set('username', e.target.value)} required autoComplete="off" />
                </Field>
                <Field label={t('servers.form.ftp.password')} required={!isEdit} hint={isEdit ? t('servers.form.password.keep') : undefined}>
                  <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required={!isEdit} autoComplete="new-password" />
                </Field>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50 dark:border-white/[0.08] dark:hover:bg-white/[0.03]">
                <Checkbox className="mt-0.5" checked={form.ftps} onChange={(e) => set('ftps', e.target.checked)} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{t('servers.form.ftp.ftps')}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('servers.form.ftp.ftps.hint')}</span>
                </span>
              </label>
              <Field label={t('servers.form.ftp.docroot')} labelAddon={t('common.optional')} hint={t('servers.form.ftp.docroot.hint')}>
                <Input mono type="text" value={form.docroot} onChange={(e) => set('docroot', e.target.value)} placeholder="/public_html" autoComplete="off" />
              </Field>
            </Section>
          </>
        )}

        {kind === 'wordpress' && (
          <>
            <Section title={t('servers.form.section.site')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('servers.form.name')} required>
                  <Input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={t('servers.form.name.placeholder.wordpress')} required autoFocus />
                </Field>
                {siteUrlField}
              </div>
            </Section>

            <Divider />

            <Section title={t('servers.form.section.wordpress')} description={t('servers.form.section.wordpress.hint')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('servers.form.wp.username')} required>
                  <Input mono type="text" value={form.username} onChange={(e) => set('username', e.target.value)} required autoComplete="off" />
                </Field>
                <Field label={t('servers.form.wp.password')} required={!isEdit} hint={isEdit ? t('servers.form.password.keep') : t('servers.form.wp.password.hint')}>
                  <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required={!isEdit} autoComplete="new-password" />
                </Field>
              </div>
            </Section>
          </>
        )}
      </form>
    </Modal>
  );
}

export default ServerFormModal;
