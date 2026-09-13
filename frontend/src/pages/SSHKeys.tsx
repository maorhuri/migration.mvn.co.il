import { useEffect, useState } from 'react';
import { ArrowUpTrayIcon, PlusIcon } from '@heroicons/react/20/solid';
import { ExclamationTriangleIcon, KeyIcon } from '@heroicons/react/24/outline';
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
  PageHeader,
  SkeletonTable,
} from '../components/ui';
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
      toast.error('Failed to fetch SSH keys');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImporting(true);
    try {
      await createSSHKey(formData);
      toast.success('SSH key added successfully');
      setIsModalOpen(false);
      setFormData(EMPTY_FORM);
      fetchKeys();
    } catch (error) {
      toast.error('Failed to add SSH key');
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSSHKey(id);
      toast.success('SSH key deleted');
      if (viewKey?.id === id) setViewKey(null);
      fetchKeys();
    } catch (error) {
      toast.error('Failed to delete SSH key');
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
      toast.success('SSH key generated');
      setGenerateOpen(false);
      setGenerateName('');
      await fetchKeys();
      setViewKey(created);
    } catch (error) {
      toast.error('Failed to generate SSH key');
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleDefault = async (key: SSHKey) => {
    setPendingDefaultId(key.id);
    try {
      if (key.is_default) {
        await unsetDefaultSSHKey(key.id);
        toast.success(`${key.name} is no longer the default key`);
      } else {
        await setDefaultSSHKey(key.id);
        toast.success(`${key.name} is now the default for cluster nodes`);
      }
      await fetchKeys();
    } catch (error) {
      toast.error(key.is_default ? 'Failed to unset default key' : 'Failed to set default key');
    } finally {
      setPendingDefaultId(null);
    }
  };

  const openGenerate = () => setGenerateOpen(true);
  const openImport = () => setIsModalOpen(true);

  // Keep the view modal in sync with the freshest copy of the key (e.g. after toggling default).
  const currentViewKey = viewKey ? keys.find((k) => k.id === viewKey.id) ?? viewKey : null;
  const defaultKey = keys.find((k) => k.is_default) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SSH keys"
        description="Keys the tool uses to authenticate against servers and Enhance cluster nodes."
        actions={
          <>
            <Button variant="secondary" leftIcon={<ArrowUpTrayIcon />} onClick={openImport}>
              Import key
            </Button>
            <Button variant="primary" leftIcon={<PlusIcon />} onClick={openGenerate}>
              Generate key
            </Button>
          </>
        }
      />

      {!loading && keys.length > 0 && <DefaultKeyCallout defaultKey={defaultKey} onView={setViewKey} />}

      <Card flush>
        <CardHeader
          divided
          actions={
            !loading && keys.length > 0 ? (
              <Badge tone="neutral" size="sm">
                {keys.length} {keys.length === 1 ? 'key' : 'keys'}
              </Badge>
            ) : undefined
          }
        >
          <CardTitle>All keys</CardTitle>
          <CardDescription>Private keys are stored on the tool; only the public half is ever installed on servers.</CardDescription>
        </CardHeader>

        {loading ? (
          <SkeletonTable rows={4} columns={5} />
        ) : loadError && keys.length === 0 ? (
          <EmptyState
            icon={ExclamationTriangleIcon}
            title="Could not load SSH keys"
            description="The API did not respond. Check that the backend is running and try again."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setLoading(true);
                  fetchKeys();
                }}
              >
                Retry
              </Button>
            }
          />
        ) : keys.length === 0 ? (
          <EmptyState
            icon={KeyIcon}
            title="No SSH keys yet"
            description="Generate a key on the tool or import an existing one to authenticate against servers and cluster nodes."
            action={
              <Button variant="primary" leftIcon={<PlusIcon />} onClick={openGenerate}>
                Generate key
              </Button>
            }
            secondaryAction={
              <Button variant="secondary" leftIcon={<ArrowUpTrayIcon />} onClick={openImport}>
                Import key
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
        title="Delete SSH key?"
        message={
          <>
            This removes <span className="font-medium text-slate-900 dark:text-slate-100">{toDelete?.name}</span> from the tool.
            {toDelete?.is_default && ' It is the default key for Enhance cluster nodes; migrations to those nodes will need a new default.'}{' '}
            Servers that already have the public key installed keep accepting it until you remove it there.
          </>
        }
        confirmLabel="Delete key"
        onConfirm={async () => {
          if (!toDelete) return;
          await handleDelete(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
