import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowPathIcon, CheckIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/20/solid';
import toast from 'react-hot-toast';
import {
  getServers,
  createServer,
  updateServer,
  deleteServer,
  testServerConnection,
  getSSHKeys,
  refreshServerAccounts,
} from '../api/client';
import type { Server, SSHKey } from '../types';
import { Button, Card, ConfirmDialog, EmptyState, Input, Mono, PageHeader, Select } from '../components/ui';
import { useT } from '../lib/i18n';
import { ServerCard, ServerCardSkeleton, type ServerTestResult } from '../components/servers/ServerCard';
import { EMPTY_SERVER_FORM, ServerFormModal, usePanelTypeOptions, type ServerFormData } from '../components/servers/ServerFormModal';

// Two roomy cards per row; three only on wide screens (2xl) where each card still holds a full name, a test chip and both actions.
const GRID = 'grid gap-4 md:grid-cols-2 2xl:grid-cols-3';

export default function Servers() {
  const navigate = useNavigate();
  const t = useT();
  const panelOptions = usePanelTypeOptions();
  const [servers, setServers] = useState<Server[]>([]);
  const [sshKeys, setSSHKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [refreshingServer, setRefreshingServer] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<Server | null>(null);
  // Result of the last "Test connection" per server in this session (presence chip on the card).
  const [lastTests, setLastTests] = useState<Record<string, ServerTestResult>>({});

  // Toolbar filters (client-side only)
  const [query, setQuery] = useState('');
  const [panelFilter, setPanelFilter] = useState<'' | Server['panel_type']>('');

  const [formData, setFormData] = useState<ServerFormData>(EMPTY_SERVER_FORM);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [serversData, keysData] = await Promise.all([getServers(), getSSHKeys()]);
      setServers(serversData);
      setSSHKeys(keysData);
      setLoadError(null);
    } catch (error) {
      setLoadError('servers.error.load');
      toast.error(t('servers.error.load'));
    } finally {
      setLoading(false);
    }
  };

  const retryFetch = () => {
    setLoading(true);
    fetchData();
  };

  const openCreate = () => {
    setEditingServer(null);
    setFormData(EMPTY_SERVER_FORM);
    setIsModalOpen(true);
  };

  const openEdit = (server: Server) => {
    setEditingServer(server);
    setFormData({
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
      enhance_org_id: server.enhance_org_id ?? '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setIsModalOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingServer) {
        // Secrets are never returned by the API — blank means "keep current".
        const { password, api_key, ...rest } = formData;
        await updateServer(editingServer.id, {
          ...rest,
          ...(password ? { password } : {}),
          ...(api_key ? { api_key } : {}),
        });
        toast.success(t('servers.toast.updated'));
      } else {
        await createServer(formData);
        toast.success(t('servers.toast.added'));
      }
      setIsModalOpen(false);
      setEditingServer(null);
      setFormData(EMPTY_SERVER_FORM);
      fetchData();
    } catch (error) {
      toast.error(editingServer ? t('servers.toast.updateFailed') : t('servers.toast.addFailed'));
    } finally {
      setSaving(false);
    }
  };

  const openDeleteModal = (server: Server) => {
    setServerToDelete(server);
    setDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!serverToDelete) return;
    try {
      await deleteServer(serverToDelete.id);
      toast.success(t('servers.toast.deleted'));
      setDeleteModalOpen(false);
      setServerToDelete(null);
      fetchData();
    } catch (error) {
      toast.error(t('servers.toast.deleteFailed'));
    }
  };

  const handleTest = async (id: string) => {
    setTestingServer(id);
    try {
      const result = await testServerConnection(id);
      if (result.success) {
        toast.success(t('servers.toast.testOk'));
      } else {
        toast.error(t('servers.toast.testFailed', { message: result.message }));
      }
      setLastTests((prev) => ({ ...prev, [id]: { ok: result.success, at: new Date() } }));
    } catch (error) {
      toast.error(t('servers.toast.testError'));
      setLastTests((prev) => ({ ...prev, [id]: { ok: false, at: new Date() } }));
    } finally {
      setTestingServer(null);
    }
  };

  const handleRefresh = async (id: string, panelType: string) => {
    // Skip refresh for Enhance servers (they have clusters)
    if (panelType === 'enhance') {
      toast.error(t('servers.toast.refreshEnhance'));
      return;
    }
    setRefreshingServer(id);
    try {
      await refreshServerAccounts(id);
      toast.success(t('servers.toast.refreshed'));
    } catch (error) {
      toast.error(t('servers.toast.refreshFailed'));
    } finally {
      setRefreshingServer(null);
    }
  };

  const filteredServers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return servers.filter((s) => {
      if (panelFilter && s.panel_type !== panelFilter) return false;
      if (!q) return true;
      return [s.name, s.host, s.username, `${s.host}:${s.port}`].some((v) => v.toLowerCase().includes(q));
    });
  }, [servers, query, panelFilter]);

  const hasFilters = query.trim() !== '' || panelFilter !== '';
  const clearFilters = () => {
    setQuery('');
    setPanelFilter('');
  };

  const stagger = (i: number) => ({ '--i': i } as CSSProperties);

  const renderBody = () => {
    if (loading) {
      return (
        <div className={GRID} role="status" aria-label={t('a11y.loadingX', { name: t('servers.title') })}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ServerCardSkeleton key={i} className="motion-safe:animate-rise stagger" style={stagger(2 + i)} />
          ))}
        </div>
      );
    }

    if (loadError && servers.length === 0) {
      return (
        <Card flush className="motion-safe:animate-rise stagger" style={stagger(2)}>
          <EmptyState
            illustration="error"
            title={t('servers.error.load')}
            description={t('servers.error.load.description')}
            action={
              <Button variant="primary" leftIcon={<ArrowPathIcon />} onClick={retryFetch}>
                {t('common.tryAgain')}
              </Button>
            }
          />
        </Card>
      );
    }

    if (servers.length === 0) {
      const benefits = [
        { title: t('servers.empty.b1.title'), text: t('servers.empty.b1.text') },
        { title: t('servers.empty.b2.title'), text: t('servers.empty.b2.text') },
        { title: t('servers.empty.b3.title'), text: t('servers.empty.b3.text') },
      ];
      return (
        <Card flush className="motion-safe:animate-rise stagger" style={stagger(2)}>
          <EmptyState
            illustration="servers"
            title={t('servers.empty.title')}
            description={t('servers.empty.description')}
            className="pb-0"
            action={
              <Button variant="primary" leftIcon={<PlusIcon />} onClick={openCreate}>
                {t('servers.add')}
              </Button>
            }
          />
          <ul className="mx-auto mt-6 grid max-w-3xl gap-2 px-6 pb-12 text-start sm:grid-cols-3">
            {benefits.map((b) => (
              <li key={b.title} className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" aria-hidden="true">
                  <CheckIcon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{b.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{b.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      );
    }

    if (filteredServers.length === 0) {
      return (
        <Card flush className="motion-safe:animate-rise stagger" style={stagger(2)}>
          <EmptyState
            size="sm"
            illustration="search"
            title={t('servers.noMatch.title')}
            description={t('servers.noMatch.description')}
            action={
              <Button variant="secondary" onClick={clearFilters}>
                {t('common.clearFilters')}
              </Button>
            }
          />
        </Card>
      );
    }

    return (
      <div className={GRID}>
        {filteredServers.map((server, i) => (
          <ServerCard
            key={server.id}
            server={server}
            style={stagger(2 + i)}
            testing={testingServer === server.id}
            refreshing={refreshingServer === server.id}
            lastTest={lastTests[server.id]}
            onTest={() => handleTest(server.id)}
            onRefresh={() => handleRefresh(server.id, server.panel_type)}
            onView={() => navigate(`/servers/${server.id}`)}
            onEdit={() => openEdit(server)}
            onDelete={() => openDeleteModal(server)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('servers.title')}
        description={t('servers.description')}
        actions={
          <Button variant="primary" leftIcon={<PlusIcon />} onClick={openCreate}>
            {t('servers.add')}
          </Button>
        }
      />

      {(loading || servers.length > 0) && (
        <div className="flex flex-col gap-3 motion-safe:animate-rise stagger sm:flex-row sm:items-center sm:justify-between" style={stagger(1)}>
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="w-full sm:max-w-xs">
              <Input
                size="sm"
                leftIcon={<MagnifyingGlassIcon />}
                placeholder={t('servers.search.placeholder')}
                aria-label={t('servers.search.aria')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-44">
              <Select
                size="sm"
                aria-label={t('servers.filter.panel.aria')}
                value={panelFilter}
                onChange={(e) => setPanelFilter(e.target.value as '' | Server['panel_type'])}
                placeholder={t('servers.filter.panel.all')}
                options={panelOptions}
              />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                {t('common.clear')}
              </Button>
            )}
          </div>
          {!loading && servers.length > 0 && (
            <p className="shrink-0 text-xs text-slate-500 tabular dark:text-slate-400 sm:text-end">
              {hasFilters
                ? t('servers.count.filtered', { shown: filteredServers.length, total: t('units.servers', { count: servers.length }) })
                : t('units.servers', { count: servers.length })}
            </p>
          )}
        </div>
      )}

      {renderBody()}

      <ServerFormModal
        open={isModalOpen}
        onClose={closeModal}
        mode={editingServer ? 'edit' : 'create'}
        form={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        sshKeys={sshKeys}
        saving={saving}
      />

      <ConfirmDialog
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title={t('servers.delete.title')}
        message={t.rich('servers.delete.message', {
          name: <Mono className="font-medium text-slate-900 dark:text-slate-100">{serverToDelete?.name}</Mono>,
        })}
        confirmLabel={t('servers.delete.confirm')}
        confirmText={serverToDelete?.name}
        onConfirm={handleDelete}
      />
    </div>
  );
}
