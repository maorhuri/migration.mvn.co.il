import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowUpTrayIcon, PlusIcon } from '@heroicons/react/20/solid';
import toast from 'react-hot-toast';
import {
  getSSHKeys,
  createSSHKey,
  deleteSSHKey,
  generateSSHKey,
  setDefaultSSHKey,
  unsetDefaultSSHKey,
} from '../api/client';
import type { SSHKey } from '../types';
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Mono,
  PageHeader,
  SkeletonTable,
} from '../components/ui';
import { useT } from '../lib/i18n';
import { DefaultKeyCallout } from '../components/sshkeys/DefaultKeyCallout';
import { GenerateKeyModal } from '../components/sshkeys/GenerateKeyModal';
import { ImportKeyModal, type ImportKeyFormData } from '../components/sshkeys/ImportKeyModal';
import { KeyViewModal } from '../components/sshkeys/KeyViewModal';
import { SSHKeysTable } from '../components/sshkeys/SSHKeysTable';

const EMPTY_FORM: ImportKeyFormData = {
  name: '',
  public_key: '',
  private_key: '',
  passphrase: '',
};

export default function SSHKeys() {
  const t = useT();
  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const [formData, setFormData] = useState<ImportKeyFormData>(EMPTY_FORM);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateName, setGenerateName] = useState('');
  const [generating, setGenerating] = useState(false);

  const [viewKey, setViewKey] = useState<SSHKey | null>(null);
  const [toDelete, setToDelete] = useState<SSHKey | null>(null);
  const [pendingDefaultId, setPendingDefaultId] = useState<string | null>(null);

  useEffect(() => {
    fetchKeys();
  }, []);

  const fetchKeys = async () => {
    try {
      const data = await getSSHKeys();
      setKeys(data);
      setLoadError(false);
    } catch (error) {
      setLoadError(true);
      toast.error(t('sshkeys.toast.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImporting(true);
    try {
      await createSSHKey(formData);
      toast.success(t('sshkeys.toast.imported'));
      setIsModalOpen(false);
      setFormData(EMPTY_FORM);
      fetchKeys();
    } catch (error) {
      toast.error(t('sshkeys.toast.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSSHKey(id);
      toast.success(t('sshkeys.toast.deleted'));
      if (viewKey?.id === id) setViewKey(null);
      fetchKeys();
    } catch (error) {
      toast.error(t('sshkeys.toast.deleteFailed'));
    }
  };

  const handleFileUpload = (field: 'public_key' | 'private_key') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setFormData((prev) => ({ ...prev, [field]: content }));
    };
    reader.readAsText(file);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    try {
      const created = await generateSSHKey({ name: generateName.trim() });
      toast.success(t('sshkeys.toast.generated'));
      setGenerateOpen(false);
      setGenerateName('');
      await fetchKeys();
      setViewKey(created);
    } catch (error) {
      toast.error(t('sshkeys.toast.generateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleDefault = async (key: SSHKey) => {
    setPendingDefaultId(key.id);
    try {
      if (key.is_default) {
        await unsetDefaultSSHKey(key.id);
        toast.success(t('sshkeys.toast.noLongerDefault', { name: key.name }));
      } else {
        await setDefaultSSHKey(key.id);
        toast.success(t('sshkeys.toast.nowDefault', { name: key.name }));
      }
      await fetchKeys();
    } catch (error) {
      toast.error(key.is_default ? t('sshkeys.toast.unsetDefaultFailed') : t('sshkeys.toast.setDefaultFailed'));
    } finally {
      setPendingDefaultId(null);
    }
  };

  const openGenerate = () => setGenerateOpen(true);
  const openImport = () => setIsModalOpen(true);

  // Keep the view modal in sync with the freshest copy of the key (e.g. after toggling default).
  const currentViewKey = viewKey ? keys.find((k) => k.id === viewKey.id) ?? viewKey : null;
  const defaultKey = keys.find((k) => k.is_default) ?? null;
  const hasKeys = !loading && keys.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('sshkeys.title')}
        description={t('sshkeys.description')}
        actions={
          <>
            <Button variant="secondary" leftIcon={<ArrowUpTrayIcon />} onClick={openImport}>
              {t('sshkeys.import')}
            </Button>
            <Button variant="primary" leftIcon={<PlusIcon />} onClick={openGenerate}>
              {t('sshkeys.generate')}
            </Button>
          </>
        }
      />

      {hasKeys && (
        <DefaultKeyCallout
          defaultKey={defaultKey}
          onView={setViewKey}
          className="motion-safe:animate-rise stagger"
          style={{ '--i': 1 } as CSSProperties}
        />
      )}

      <Card flush className="motion-safe:animate-rise stagger" style={{ '--i': hasKeys ? 2 : 1 } as CSSProperties}>
        <CardHeader
          divided
          actions={
            hasKeys ? (
              <Badge tone="neutral" size="sm">
                {t('units.keys', { count: keys.length })}
              </Badge>
            ) : undefined
          }
        >
          <CardTitle>{t('sshkeys.all.title')}</CardTitle>
          <CardDescription>{t('sshkeys.all.description')}</CardDescription>
        </CardHeader>

        {loading ? (
          <SkeletonTable rows={4} columns={5} />
        ) : loadError && keys.length === 0 ? (
          <EmptyState
            illustration="error"
            title={t('sshkeys.error.title')}
            description={t('sshkeys.error.description')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setLoading(true);
                  fetchKeys();
                }}
              >
                {t('common.retry')}
              </Button>
            }
          />
        ) : keys.length === 0 ? (
          <EmptyState
            illustration="keys"
            title={t('sshkeys.empty.title')}
            description={
              <ul className="mt-2 space-y-1.5 text-start text-wrap">
                {(['sshkeys.empty.b1', 'sshkeys.empty.b2', 'sshkeys.empty.b3'] as const).map((k) => (
                  <li key={k} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400 dark:bg-brand-300" />
                    <span>{t(k)}</span>
                  </li>
                ))}
              </ul>
            }
            action={
              <Button variant="primary" leftIcon={<PlusIcon />} onClick={openGenerate}>
                {t('sshkeys.generate')}
              </Button>
            }
            secondaryAction={
              <Button variant="secondary" leftIcon={<ArrowUpTrayIcon />} onClick={openImport}>
                {t('sshkeys.import')}
              </Button>
            }
          />
        ) : (
          <SSHKeysTable
            keys={keys}
            onView={setViewKey}
            onToggleDefault={handleToggleDefault}
            onDelete={setToDelete}
            pendingDefaultId={pendingDefaultId}
          />
        )}
      </Card>

      <GenerateKeyModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        name={generateName}
        onNameChange={setGenerateName}
        onSubmit={handleGenerate}
        loading={generating}
      />

      <ImportKeyModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        formData={formData}
        onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
        onSubmit={handleSubmit}
        onFileUpload={handleFileUpload}
        loading={importing}
      />

      <KeyViewModal
        sshKey={currentViewKey}
        onClose={() => setViewKey(null)}
        onToggleDefault={handleToggleDefault}
        pendingDefaultId={pendingDefaultId}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={t('sshkeys.delete.title')}
        message={
          <>
            {t.rich('sshkeys.delete.message', {
              name: <Mono className="font-medium text-slate-900 dark:text-slate-100">{toDelete?.name}</Mono>,
            })}
            {toDelete?.is_default && <> {t('sshkeys.delete.defaultNote')}</>} {t('sshkeys.delete.serversNote')}
          </>
        }
        confirmLabel={t('sshkeys.delete.confirm')}
        onConfirm={async () => {
          if (!toDelete) return;
          await handleDelete(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
