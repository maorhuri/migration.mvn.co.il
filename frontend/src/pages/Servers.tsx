import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExclamationTriangleIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import { ArrowPathIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/20/solid';
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
import { Button, Card, ConfirmDialog, EmptyState, Input, PageHeader, Select, SkeletonCard } from '../components/ui';
import { ServerCard } from '../components/servers/ServerCard';
import { EMPTY_SERVER_FORM, PANEL_TYPE_OPTIONS, ServerFormModal, type ServerFormData } from '../components/servers/ServerFormModal';

export default function Servers() {
  const navigate = useNavigate();
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
      setLoadError('Failed to fetch servers');
      toast.error('Failed to fetch servers');
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
        toast.success('Server updated');
      } else {
        await createServer(formData);
        toast.success('Server added successfully');
      }
      setIsModalOpen(false);
      setEditingServer(null);
      setFormData(EMPTY_SERVER_FORM);
      fetchData();
    } catch (error) {
      toast.error(editingServer ? 'Failed to update server' : 'Failed to add server');
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
      toast.success('Server deleted');
      setDeleteModalOpen(false);
      setServerToDelete(null);
      fetchData();
    } catch (error) {
      toast.error('Failed to delete server');
    }
  };

  const handleTest = async (id: string) => {
    setTestingServer(id);
    try {
      const result = await testServerConnection(id);
      if (result.success) {
        toast.success('Connection successful!');
      } else {
        toast.error(`Connection failed: ${result.message}`);
      }
    } catch (error) {
      toast.error('Connection test failed');
    } finally {
      setTestingServer(null);
    }
  };

  const handleRefresh = async (id: string, panelType: string) => {
    // Skip refresh for Enhance servers (they have clusters)
    if (panelType === 'enhance') {
      toast.error('Enhance servers use cluster - refresh from server details');
      return;
    }
    setRefreshingServer(id);
    try {
      await refreshServerAccounts(id);
      toast.success('Accounts refreshed!');
    } catch (error) {
      toast.error('Failed to refresh accounts');
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

  const renderBody = () => {
    if (loading) {
      return (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading servers">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonCard key={i} lines={5} />
          ))}
        </div>
      );
    }

    if (loadError && servers.length === 0) {
      return (
        <Card flush>
          <EmptyState
            icon={ExclamationTriangleIcon}
            title="Couldn't load servers"
            description={loadError}
            action={
              <Button variant="primary" leftIcon={<ArrowPathIcon />} onClick={retryFetch}>
                Retry
              </Button>
            }
          />
        </Card>
      );
    }

    if (servers.length === 0) {
      return (
        <Card flush>
          <EmptyState
            icon={ServerStackIcon}
            title="No servers yet"
            description="Add a source or target server to start migrating accounts."
            action={
              <Button variant="primary" leftIcon={<PlusIcon />} onClick={openCreate}>
                Add server
              </Button>
            }
          />
        </Card>
      );
    }

    if (filteredServers.length === 0) {
      return (
        <Card flush>
          <EmptyState
            size="sm"
            icon={MagnifyingGlassIcon}
            title="No matching servers"
            description="Try a different search or clear the panel filter."
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        </Card>
      );
    }

    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredServers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            testing={testingServer === server.id}
            refreshing={refreshingServer === server.id}
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
        title="Servers"
        description="Source and target hosts available for migrations."
        actions={
          <Button variant="primary" leftIcon={<PlusIcon />} onClick={openCreate}>
            Add server
          </Button>
        }
      />

      {(loading || servers.length > 0) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="w-full sm:max-w-xs">
              <Input
                size="sm"
                leftIcon={<MagnifyingGlassIcon />}
                placeholder="Search name, host or user…"
                aria-label="Search servers"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-44">
              <Select
                size="sm"
                aria-label="Filter by panel type"
                value={panelFilter}
                onChange={(e) => setPanelFilter(e.target.value as '' | Server['panel_type'])}
                placeholder="All panel types"
                options={PANEL_TYPE_OPTIONS}
              />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </div>
          {!loading && servers.length > 0 && (
            <p className="text-xs text-slate-500 tabular dark:text-slate-400">
              {hasFilters ? `${filteredServers.length} of ${servers.length}` : servers.length}{' '}
              {servers.length === 1 && !hasFilters ? 'server' : 'servers'}
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
        title="Delete server?"
        message={
          <>
            This removes <span className="font-medium text-slate-900 dark:text-slate-100">{serverToDelete?.name}</span> and its stored
            credentials. This action cannot be undone.
          </>
        }
        confirmLabel="Delete server"
        confirmText={serverToDelete?.name}
        onConfirm={handleDelete}
      />
    </div>
  );
}
