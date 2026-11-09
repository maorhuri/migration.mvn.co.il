import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircleIcon } from '@heroicons/react/20/solid';
import { getCloudflareSettings, updateCloudflareSettings } from '../api/client';
import { Badge, Button, Card, CardDescription, CardFooter, CardHeader, CardTitle, Field, Input, Skeleton } from '../components/ui';
import { PageHeader } from '../components/ui/PageHeader';
import { useT } from '../lib/i18n';

export default function Settings() {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [token, setToken] = useState('');

  const load = async () => {
    try {
      const s = await getCloudflareSettings();
      setConfigured(s.configured);
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
      });
      setConfigured(s.configured);
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
    </div>
  );
}
