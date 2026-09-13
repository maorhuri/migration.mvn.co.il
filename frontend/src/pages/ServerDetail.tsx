import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  CircleStackIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  SignalIcon,
} from '@heroicons/react/20/solid';
import { CpuChipIcon, ServerStackIcon as ServerStackOutlineIcon, UsersIcon as UsersOutlineIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { getServer, getServerAccounts, getServerInfo, testServerConnection, updateServer, getSSHKeys, refreshServerAccounts } from '../api/client';
import type { Server, Account, SSHKey } from '../types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  Input,
  KeyValue,
  PageHeader,
  PanelBadge,
  Skeleton,
  SkeletonCard,
  SkeletonTable,
  Stat,
  StatusBadge,
} from '../components/ui';
import { formatDate, formatRelativeTime } from '../lib/format';
import { AccountsTable } from '../components/serverdetail/AccountsTable';
import type { AccountSortField } from '../components/serverdetail/AccountsTable';
import { EditServerModal } from '../components/serverdetail/EditServerModal';
import { DatabasesModal, EmailAccountsModal } from '../components/serverdetail/AccountListModals';

interface ServerAccounts {
  accounts: Account[];
  total: number;
}

const AUTH_LABELS: Record<Server['auth_method'], string> = {
  password: 'Password',
  ssh_key: 'SSH key',
  api_key: 'API key',
};

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [server, setServer] = useState<Server | null>(null);
  const [accounts, setAccounts] = useState<ServerAccounts | null>(null);
  const [sshKeys, setSSHKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'success' | 'failed'>('unknown');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [emailModalAccount, setEmailModalAccount] = useState<Account | null>(null);
  const [dbModalAccount, setDbModalAccount] = useState<Account | null>(null);
  const [serverInfo, setServerInfo] = useState<{
    web_server?: string;
    total_disk?: string;
    used_disk?: string;
    os_version?: string;
    php_versions?: string;
  } | null>(null);
  // Where the current account list came from: the server-side cache (initial load) or a live refresh.
  const [accountsSource, setAccountsSource] = useState<{ kind: 'cached' | 'refreshed'; at: Date } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<string>('domain');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [editFormData, setEditFormData] = useState({
    name: '',
    panel_type: 'directadmin' as Server['panel_type'],
    host: '',
    port: 22,
    username: 'root',
    auth_method: 'password' as Server['auth_method'],
    password: '',
    ssh_key_id: '',
    api_endpoint: '',
    api_key: '',
  });

  useEffect(() => {
    if (id) {
      loadServer();
      loadSSHKeys();
      // Auto-load cached accounts
      loadAccounts();
    }
  }, [id]);

  const loadServer = async () => {
    try {
      const data = await getServer(id!);
      setServer(data);
      setEditFormData({
        name: data.name,
        panel_type: data.panel_type,
        host: data.host,
        port: data.port,
        username: data.username,
        auth_method: data.auth_method,
        password: '',
        ssh_key_id: data.ssh_key_id || '',
        api_endpoint: data.api_endpoint || '',
        api_key: '',
      });
    } catch (error) {
      toast.error('Failed to load server');
      navigate('/servers');
    } finally {
      setLoading(false);
    }
  };

  const loadSSHKeys = async () => {
    try {
      const keys = await getSSHKeys();
      setSSHKeys(keys);
    } catch (error) {
      console.error('Failed to load SSH keys:', error);
    }
  };

  const loadServerInfo = async () => {
    if (!id) return;
    try {
      const info = await getServerInfo(id);
      setServerInfo(info);
    } catch (error) {
      console.error('Failed to load server info:', error);
    }
  };

  const handleTestConnection = async () => {
    if (!id) return;
    setTesting(true);
    try {
      const result = await testServerConnection(id);
      if (result.success) {
        setConnectionStatus('success');
        toast.success('Connection successful!');
        loadServerInfo();
      } else {
        setConnectionStatus('failed');
        toast.error(result.message || 'Connection failed');
      }
    } catch (error) {
      setConnectionStatus('failed');
      toast.error('Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const loadAccounts = async () => {
    if (!id) return;
    setLoadingAccounts(true);
    try {
      const data = await getServerAccounts(id);
      setAccounts(data);
      setAccountsSource({ kind: 'cached', at: new Date() });
    } catch (error) {
      toast.error('Failed to load accounts');
    } finally {
      setLoadingAccounts(false);
    }
  };

  const handleRefreshAccounts = async () => {
    if (!id) return;
    setLoadingAccounts(true);
    try {
      const data = await refreshServerAccounts(id);
      setAccounts(data);
      setAccountsSource({ kind: 'refreshed', at: new Date() });
      toast.success('Accounts refreshed successfully');
    } catch (error) {
      toast.error('Failed to refresh accounts');
    } finally {
      setLoadingAccounts(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    try {
      await updateServer(id, editFormData);
      toast.success('Server updated successfully');
      setIsEditModalOpen(false);
      loadServer();
    } catch (error) {
      toast.error('Failed to update server');
    } finally {
      setSaving(false);
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const parseSize = (size: string | undefined): number => {
    if (!size) return 0;
    const match = size.match(/^([\d.]+)\s*([KMGT]?)B?$/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const multipliers: Record<string, number> = { '': 1, 'K': 1024, 'M': 1024*1024, 'G': 1024*1024*1024, 'T': 1024*1024*1024*1024 };
    return num * (multipliers[unit] || 1);
  };

  const filteredAndSortedAccounts = accounts?.accounts
    .filter(acc =>
      acc.domain?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      acc.username?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';

      switch (sortField) {
        case 'domain':
          aVal = a.domain || '';
          bVal = b.domain || '';
          break;
        case 'php':
          aVal = a.php_version || '';
          bVal = b.php_version || '';
          break;
        case 'disk':
          aVal = parseSize(a.disk_used);
          bVal = parseSize(b.disk_used);
          break;
        case 'db_size':
          aVal = parseSize(a.db_size);
          bVal = parseSize(b.db_size);
          break;
        case 'dbs':
          aVal = a.databases?.length || 0;
          bVal = b.databases?.length || 0;
          break;
        case 'emails':
          aVal = a.email_accounts?.length || 0;
          bVal = b.email_accounts?.length || 0;
          break;
        case 'type':
          aVal = a.is_wordpress ? 1 : 0;
          bVal = b.is_wordpress ? 1 : 0;
          break;
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortDirection === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    }) || [];

  if (loading) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading server">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Stat key={i} label={<Skeleton className="h-3 w-20" />} value="" loading />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
        <Card flush>
          <SkeletonTable rows={6} columns={9} />
        </Card>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumb={[{ label: 'Servers', to: '/servers' }, { label: 'Not found' }]}
          title="Server not found"
          description={id ? <span className="font-mono text-[13px]">{id}</span> : undefined}
        />
        <Card flush>
          <EmptyState
            icon={ServerStackOutlineIcon}
            title="Server not found"
            description="This server may have been removed or the link is out of date."
            action={<Button variant="primary" onClick={() => navigate('/servers')}>Back to servers</Button>}
          />
        </Card>
      </div>
    );
  }

  const totalDatabases = accounts ? accounts.accounts.reduce((sum, acc) => sum + (acc.databases?.length || 0), 0) : 0;
  const wordpressCount = accounts ? accounts.accounts.filter((acc) => acc.is_wordpress).length : 0;
  const sshKeyName = server.ssh_key_id ? sshKeys.find((k) => k.id === server.ssh_key_id)?.name : undefined;
  const hasAccounts = !!accounts && accounts.accounts.length > 0;
  const hasSystemInfo = !!serverInfo && !!(serverInfo.os_version || serverInfo.web_server || serverInfo.total_disk || serverInfo.php_versions);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'Servers', to: '/servers' }, { label: server.name }]}
        title={server.name}
        description={
          <span className="font-mono text-[13px]">
            {server.username}@{server.host}:{server.port}
          </span>
        }
        meta={
          <>
            <PanelBadge panelType={server.panel_type} />
            <StatusBadge status={testing ? 'testing' : connectionStatus} />
          </>
        }
        actions={
          <>
            <Button variant="secondary" leftIcon={<SignalIcon />} onClick={handleTestConnection} loading={testing}>
              Test connection
            </Button>
            <Button variant="secondary" leftIcon={<ArrowPathIcon />} onClick={handleRefreshAccounts} loading={loadingAccounts}>
              Refresh accounts
            </Button>
            <Button variant="primary" leftIcon={<ArrowsRightLeftIcon />} onClick={() => navigate('/migrations/new')}>
              New migration
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Accounts"
          value={accounts ? accounts.total : '—'}
          icon={UsersOutlineIcon}
          tone="blue"
          loading={loadingAccounts && !accounts}
          hint={accounts ? `${wordpressCount} WordPress` : 'Not loaded yet'}
        />
        <Stat
          label="Databases"
          value={accounts ? totalDatabases : '—'}
          icon={CircleStackIcon}
          tone="violet"
          loading={loadingAccounts && !accounts}
          hint={accounts ? 'across all accounts' : 'Not loaded yet'}
        />
        <Stat
          label="Disk used"
          value={serverInfo?.used_disk ? <span className="font-mono text-xl">{serverInfo.used_disk}</span> : '—'}
          icon={ServerStackOutlineIcon}
          tone={serverInfo?.used_disk ? 'brand' : 'neutral'}
          hint={serverInfo?.total_disk ? `of ${serverInfo.total_disk}` : 'Test the connection to load'}
        />
        <Stat
          label="Web server"
          value={serverInfo?.web_server ? <span className="text-xl">{serverInfo.web_server}</span> : '—'}
          icon={CpuChipIcon}
          tone={serverInfo?.web_server ? 'orange' : 'neutral'}
          hint={serverInfo?.os_version ? serverInfo.os_version : 'Test the connection to load'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            actions={
              <Button size="sm" variant="ghost" leftIcon={<PencilIcon />} onClick={() => setIsEditModalOpen(true)}>
                Edit
              </Button>
            }
          >
            <CardTitle>Connection</CardTitle>
            <CardDescription>How the migration tool reaches this server.</CardDescription>
          </CardHeader>
          <KeyValue
            layout="grid"
            columns={3}
            items={[
              { label: 'Host', value: server.host, mono: true },
              { label: 'Port', value: server.port, mono: true },
              { label: 'Username', value: server.username, mono: true },
              { label: 'Auth method', value: AUTH_LABELS[server.auth_method] ?? server.auth_method },
              { label: 'Panel', value: <PanelBadge panelType={server.panel_type} size="sm" /> },
              ...(server.auth_method === 'ssh_key' ? [{ label: 'SSH key', value: sshKeyName ?? server.ssh_key_id, mono: !sshKeyName }] : []),
              ...(server.api_endpoint ? [{ label: 'API endpoint', value: server.api_endpoint, mono: true, span: true }] : []),
              ...(server.enhance_org_id ? [{ label: 'Enhance org', value: server.enhance_org_id, mono: true, span: true }] : []),
              { label: 'Added', value: <span title={formatDate(server.created_at)}>{formatRelativeTime(server.created_at)}</span> },
            ]}
          />
        </Card>

        <Card>
          <CardHeader
            actions={
              <Button size="sm" variant="ghost" leftIcon={<ArrowPathIcon />} onClick={handleTestConnection} loading={testing}>
                {hasSystemInfo ? 'Reload' : 'Load'}
              </Button>
            }
          >
            <CardTitle>System</CardTitle>
            <CardDescription>Reported by the server after a successful connection test.</CardDescription>
          </CardHeader>
          {hasSystemInfo ? (
            <KeyValue
              layout="grid"
              columns={2}
              items={[
                { label: 'Operating system', value: serverInfo?.os_version, span: true },
                { label: 'Web server', value: serverInfo?.web_server, mono: true },
                {
                  label: 'Disk',
                  value: serverInfo?.total_disk ? `${serverInfo.used_disk ?? '?'} / ${serverInfo.total_disk}` : undefined,
                  mono: true,
                },
                {
                  label: 'PHP versions',
                  value: serverInfo?.php_versions ? (
                    <span className="flex flex-wrap gap-1">
                      {serverInfo.php_versions
                        .split(/[,\s]+/)
                        .filter(Boolean)
                        .map((v) => (
                          <Badge key={v} tone="neutral" size="sm" mono>
                            {v}
                          </Badge>
                        ))}
                    </span>
                  ) : undefined,
                  span: true,
                },
              ]}
            />
          ) : (
            <EmptyState
              size="sm"
              icon={CpuChipIcon}
              title="No system info yet"
              description="Run a connection test to read the OS, web server, disk and PHP versions."
              action={
                <Button size="sm" variant="secondary" leftIcon={<SignalIcon />} onClick={handleTestConnection} loading={testing}>
                  Test connection
                </Button>
              }
            />
          )}
        </Card>
      </div>

      <Card flush>
        <CardHeader
          divided
          actions={
            hasAccounts ? (
              <Input
                size="sm"
                type="search"
                aria-label="Search accounts"
                leftIcon={<MagnifyingGlassIcon />}
                placeholder="Search domain or username…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full sm:w-72"
              />
            ) : undefined
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Accounts</CardTitle>
            {accounts && (
              <Badge tone="neutral" size="sm">
                {searchTerm ? `${filteredAndSortedAccounts.length} of ${accounts.total}` : accounts.total}
              </Badge>
            )}
            {accountsSource && !loadingAccounts && (
              <Badge
                tone={accountsSource.kind === 'refreshed' ? 'success' : 'neutral'}
                size="sm"
                dot
                title={formatDate(accountsSource.at)}
              >
                {accountsSource.kind === 'refreshed' ? 'Refreshed' : 'Cached'} {formatRelativeTime(accountsSource.at)}
              </Badge>
            )}
            {loadingAccounts && (
              <Badge tone="info" size="sm" dot pulse>
                Loading
              </Badge>
            )}
          </div>
          <CardDescription>Hosting accounts discovered on this server. Refresh to pull the latest list from the panel.</CardDescription>
        </CardHeader>

        {loadingAccounts ? (
          <SkeletonTable rows={6} columns={9} />
        ) : !hasAccounts ? (
          <EmptyState
            icon={UsersOutlineIcon}
            title="No cached accounts"
            description="Nothing has been fetched from this server yet. Refresh to load the account list from the panel."
            action={
              <Button variant="primary" leftIcon={<ArrowPathIcon />} onClick={handleRefreshAccounts} loading={loadingAccounts}>
                Refresh accounts
              </Button>
            }
          />
        ) : filteredAndSortedAccounts.length === 0 ? (
          <EmptyState
            size="sm"
            icon={GlobeAltIcon}
            title="No matching accounts"
            description={
              <>
                Nothing matches <span className="font-mono">“{searchTerm}”</span>.
              </>
            }
            action={
              <Button variant="secondary" size="sm" onClick={() => setSearchTerm('')}>
                Clear search
              </Button>
            }
          />
        ) : (
          <AccountsTable
            accounts={filteredAndSortedAccounts}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={(field: AccountSortField) => handleSort(field)}
            onOpenDatabases={setDbModalAccount}
            onOpenEmails={setEmailModalAccount}
          />
        )}
      </Card>

      <EditServerModal
        open={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        form={editFormData}
        onChange={setEditFormData}
        sshKeys={sshKeys}
        onSubmit={handleEditSubmit}
        saving={saving}
      />

      <EmailAccountsModal account={emailModalAccount} onClose={() => setEmailModalAccount(null)} />
      <DatabasesModal account={dbModalAccount} onClose={() => setDbModalAccount(null)} />
    </div>
  );
}
