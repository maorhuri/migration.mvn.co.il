import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircleIcon } from '@heroicons/react/20/solid';
import { getCloudflareSettings, updateCloudflareSettings, getEmailSettings, updateEmailSettings } from '../api/client';
import type { EmailSettings } from '../types';
import { Badge, Button, Card, CardDescription, CardFooter, CardHeader, CardTitle, Field, Input, Select, Skeleton } from '../components/ui';
import { PageHeader } from '../components/ui/PageHeader';
import { useT } from '../lib/i18n';

export default function Settings() {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');

  const load = async () => {
    try {
      const s = await getCloudflareSettings();
      setConfigured(s.configured);
      setEmail(s.email || '');
    } catch {
      toast.error(t('settings.cf.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apiError = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

  const handleSave = async () => {
    setSaving(true);
    try {
      const s = await updateCloudflareSettings({
        api_token: token.trim() ? token.trim() : undefined,
        email: email.trim(),
      });
      setConfigured(s.configured);
      setEmail(s.email || '');
      setToken('');
      toast.success(t('settings.cf.saved'));
    } catch (error) {
      toast.error(apiError(error, t('settings.cf.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      const s = await updateCloudflareSettings({ clear: true });
      setConfigured(s.configured);
      setToken('');
      setEmail('');
      toast.success(t('settings.cf.cleared'));
    } catch (error) {
      toast.error(apiError(error, t('settings.cf.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('nav.settings')} title={t('settings.title')} description={t('settings.description')} />

      <Card className="max-w-2xl">
        <CardHeader
          actions={
            configured ? (
              <Badge tone="success" dot>
                {t('settings.cf.configured')}
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                {t('settings.cf.notConfigured')}
              </Badge>
            )
          }
        >
          <CardTitle>{t('settings.cf.title')}</CardTitle>
          <CardDescription>{t('settings.cf.description')}</CardDescription>
        </CardHeader>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        ) : (
          <div className="space-y-4">
            <Field
              label={t('settings.cf.tokenLabel')}
              hint={
                <>
                  {t('settings.cf.tokenHint')} {t('settings.cf.scopeHint')}
                  {configured && (
                    <span className="mt-1 flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
                      {t('settings.cf.configured')}
                    </span>
                  )}
                </>
              }
            >
              <Input
                type="password"
                autoComplete="off"
                mono
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('settings.cf.tokenPlaceholder')}
              />
            </Field>

            <Field label={t('settings.cf.emailLabel')} hint={t('settings.cf.emailHint')}>
              <Input
                type="email"
                autoComplete="off"
                mono
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('settings.cf.emailPlaceholder')}
              />
            </Field>
          </div>
        )}

        <CardFooter>
          {configured && (
            <Button variant="outline" onClick={handleClear} loading={saving} disabled={loading}>
              {t('settings.cf.clear')}
            </Button>
          )}
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={loading}>
            {t('settings.cf.save')}
          </Button>
        </CardFooter>
      </Card>

      <EmailSettingsCard />
    </div>
  );
}

/**
 * Central outbound-email settings applied to migrated WordPress sites (FluentSMTP) and used to
 * build SPF/DMARC in DNS. The SMTP password is write-only: a stored one is shown only as a badge
 * and never returned.
 */
function EmailSettingsCard() {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [password, setPassword] = useState('');

  const apiError = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

  const load = async () => {
    try {
      setSettings(await getEmailSettings());
    } catch {
      toast.error(t('settings.email.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const field = <K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await updateEmailSettings({
        host: settings.host,
        port: settings.port,
        encryption: settings.encryption,
        auth_user: settings.auth_user,
        auth_password: password.trim() ? password : undefined,
        from_name: settings.from_name,
        from_email: settings.from_email,
        spf_extra: settings.spf_extra,
        dmarc_policy: settings.dmarc_policy,
        dmarc_rua: settings.dmarc_rua,
      });
      setSettings(updated);
      setPassword('');
      toast.success(t('settings.email.saved'));
    } catch (error) {
      toast.error(apiError(error, t('settings.email.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleClearPassword = async () => {
    setSaving(true);
    try {
      const updated = await updateEmailSettings({ clear_password: true });
      setSettings(updated);
      setPassword('');
      toast.success(t('settings.email.passwordCleared'));
    } catch (error) {
      toast.error(apiError(error, t('settings.email.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const configured = !!settings?.configured;

  return (
    <Card className="max-w-2xl">
      <CardHeader
        actions={
          configured ? (
            <Badge tone="success" dot>
              {t('settings.email.configured')}
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              {t('settings.email.notConfigured')}
            </Badge>
          )
        }
      >
        <CardTitle>{t('settings.email.title')}</CardTitle>
        <CardDescription>{t('settings.email.description')}</CardDescription>
      </CardHeader>

      {loading || !settings ? (
        <div className="space-y-4">
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field label={t('settings.email.hostLabel')} hint={t('settings.email.hostHint')}>
              <Input autoComplete="off" mono value={settings.host} onChange={(e) => field('host', e.target.value)} placeholder={t('settings.email.hostPlaceholder')} />
            </Field>
            <Field label={t('settings.email.portLabel')}>
              <Input autoComplete="off" mono inputMode="numeric" value={settings.port} onChange={(e) => field('port', e.target.value)} placeholder="587" />
            </Field>
          </div>

          <Field label={t('settings.email.encryptionLabel')} hint={t('settings.email.encryptionHint')}>
            <Select
              value={settings.encryption || 'tls'}
              onChange={(e) => field('encryption', e.target.value)}
              options={[
                { value: 'tls', label: t('settings.email.encryption.tls') },
                { value: 'ssl', label: t('settings.email.encryption.ssl') },
                { value: 'none', label: t('settings.email.encryption.none') },
              ]}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.email.authUserLabel')} hint={t('settings.email.authUserHint')}>
              <Input autoComplete="off" mono value={settings.auth_user} onChange={(e) => field('auth_user', e.target.value)} placeholder={t('settings.email.authUserPlaceholder')} />
            </Field>
            <Field
              label={t('settings.email.authPasswordLabel')}
              hint={
                <>
                  {t('settings.email.authPasswordHint')}
                  {settings.password_configured && (
                    <span className="mt-1 flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
                      {t('settings.email.passwordStored')}
                    </span>
                  )}
                </>
              }
            >
              <Input type="password" autoComplete="new-password" mono value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('settings.email.authPasswordPlaceholder')} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.email.fromNameLabel')} hint={t('settings.email.fromNameHint')}>
              <Input autoComplete="off" value={settings.from_name} onChange={(e) => field('from_name', e.target.value)} placeholder={t('settings.email.fromNamePlaceholder')} />
            </Field>
            <Field label={t('settings.email.fromEmailLabel')} hint={t('settings.email.fromEmailHint')}>
              <Input autoComplete="off" mono value={settings.from_email} onChange={(e) => field('from_email', e.target.value)} placeholder={t('settings.email.fromEmailPlaceholder')} />
            </Field>
          </div>

          <Field label={t('settings.email.spfExtraLabel')} hint={t('settings.email.spfExtraHint')}>
            <Input autoComplete="off" mono value={settings.spf_extra} onChange={(e) => field('spf_extra', e.target.value)} placeholder={t('settings.email.spfExtraPlaceholder')} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.email.dmarcPolicyLabel')} hint={t('settings.email.dmarcPolicyHint')}>
              <Select
                value={settings.dmarc_policy || 'none'}
                onChange={(e) => field('dmarc_policy', e.target.value)}
                options={[
                  { value: 'none', label: t('settings.email.dmarc.none') },
                  { value: 'quarantine', label: t('settings.email.dmarc.quarantine') },
                  { value: 'reject', label: t('settings.email.dmarc.reject') },
                ]}
              />
            </Field>
            <Field label={t('settings.email.dmarcRuaLabel')} hint={t('settings.email.dmarcRuaHint')}>
              <Input autoComplete="off" mono value={settings.dmarc_rua} onChange={(e) => field('dmarc_rua', e.target.value)} placeholder={t('settings.email.dmarcRuaPlaceholder')} />
            </Field>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.email.dkimNote')}</p>
        </div>
      )}

      <CardFooter>
        {settings?.password_configured && (
          <Button variant="outline" onClick={handleClearPassword} loading={saving} disabled={loading}>
            {t('settings.email.clearPassword')}
          </Button>
        )}
        <Button variant="primary" onClick={handleSave} loading={saving} disabled={loading}>
          {t('settings.email.save')}
        </Button>
      </CardFooter>
    </Card>
  );
}
