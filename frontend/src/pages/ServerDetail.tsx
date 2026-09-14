import { useEffect, useState, type CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  CircleStackIcon,
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
  CodeBlock,
  EmptyState,
  Input,
  KeyValue,
  Mono,
  PageHeader,
  PanelBadge,
  ProgressBar,
  Skeleton,
  SkeletonCard,
  SkeletonTable,
  Stat,
  StatusBadge,
} from '../components/ui';
import { formatDate, formatRelativeTime, parseSizeToBytes, percent } from '../lib/format';
import { useT } from '../lib/i18n';
import { AccountsTable } from '../components/serverdetail/AccountsTable';
import type { AccountSortField } from '../components/serverdetail/AccountsTable';
import { EditServerModal } from '../components/serverdetail/EditServerModal';
import { DatabasesModal, EmailAccountsModal } from '../components/serverdetail/AccountListModals';

interface ServerAccounts {
  accounts: Account[];
  total: number;
}

const EMPTY = '—';

/** Page-load stagger index (cards rise in one after another). */
const stagger = (i: number) => ({ '--i': i }) as CSSProperties;

export default function ServerDetail() {
  const t = useT();
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
      toast.error(t('serverdetail.toast.loadFailed'));
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
        toast.success(t('serverdetail.toast.connected'));
        loadServerInfo();
      } else {
        setConnectionStatus('failed');
        toast.error(result.message || t('serverdetail.toast.connectionFailed'));
      }
    } catch (error) {
      setConnectionStatus('failed');
      toast.error(t('serverdetail.toast.testFailed'));
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
      toast.error(t('serverdetail.toast.accountsLoadFailed'));
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
      toast.success(t('serverdetail.toast.accountsRefreshed'));
    } catch (error) {
      toast.error(t('serverdetail.toast.accountsRefreshFailed'));
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
      toast.success(t('serverdetail.toast.saved'));
      setIsEditModalOpen(false);
      loadServer();
    } catch (error) {
      toast.error(t('serverdetail.toast.saveFailed'));
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
          aVal = parseSizeToBytes(a.disk_used);
          bVal = parseSizeToBytes(b.disk_used);
          break;
        case 'db_size':
          aVal = parseSizeToBytes(a.db_size);
          bVal = parseSizeToBytes(b.db_size);
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
      <div className="space-y-6" role="status" aria-label={t('a11y.loadingX', { name: t('serverdetail.eyebrow') })}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-12" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-6 w-20 rounded-md" />
            </div>
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32 rounded-lg" />
            <Skeleton className="h-9 w-36 rounded-lg" />
            <Skeleton className="h-9 w-36 rounded-lg" />
          </div>
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
          <SkeletonTable rows={6} columns={8} />
        </Card>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="space-y-6">
        <PageHeader
          backTo="/servers"
          eyebrow={t('serverdetail.eyebrow')}
          title={t('serverdetail.notFound.title')}
          description={id ? <Mono className="text-[13px]">{id}</Mono> : undefined}
        />
        <Card flush>
          <EmptyState
            illustration="servers"
            title={t('serverdetail.notFound.title')}
            description={t('serverdetail.notFound.description')}
            action={
              <Button variant="primary" onClick={() => navigate('/servers')}>
                {t('serverdetail.notFound.back')}
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const accountList = accounts?.accounts ?? [];
  const totalDatabases = accountList.reduce((sum, acc) => sum + (acc.databases?.length || 0), 0);
  const wordpressCount = accountList.filter((acc) => acc.is_wordpress).length;
  const sslCount = accountList.filter((acc) => acc.ssl_enabled).length;
  const suspendedCount = accountList.filter((acc) => acc.suspended).length;
  const sshKeyName = server.ssh_key_id ? sshKeys.find((k) => k.id === server.ssh_key_id)?.name : undefined;
  const hasAccounts = !!accounts && accounts.accounts.length > 0;
  const hasSystemInfo = !!serverInfo && !!(serverInfo.os_version || serverInfo.web_server || serverInfo.total_disk || serverInfo.php_versions);

  const phpVersions = serverInfo?.php_versions ? serverInfo.php_versions.split(/[,\s]+/).filter(Boolean) : [];
  const usedBytes = parseSizeToBytes(serverInfo?.used_disk);
  const totalBytes = parseSizeToBytes(serverInfo?.total_disk);
  const diskPercent = usedBytes > 0 && totalBytes > 0 ? percent(usedBytes, totalBytes) : null;
  const diskTone = diskPercent === null ? 'neutral' : diskPercent >= 90 ? 'danger' : diskPercent >= 75 ? 'warning' : 'success';

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/servers"
        eyebrow={t('serverdetail.eyebrow')}
        title={server.name}
        description={
          <Mono className="text-[13px]">
            {server.username}@{server.host}:{server.port}
          </Mono>
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
              {t('serverdetail.actions.test')}
            </Button>
            <Button variant="secondary" leftIcon={<ArrowPathIcon />} onClick={handleRefreshAccounts} loading={loadingAccounts}>
              {t('serverdetail.actions.refresh')}
            </Button>
            <Button variant="primary" leftIcon={<ArrowsRightLeftIcon />} onClick={() => navigate('/migrations/new')}>
              {t('serverdetail.actions.newMigration')}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="motion-safe:animate-rise stagger" style={stagger(1)}>
          <Stat
            label={t('serverdetail.stats.accounts')}
            value={accounts ? accounts.total : EMPTY}
            icon={UsersOutlineIcon}
            tone="blue"
            loading={loadingAccounts && !accounts}
            quiet={!accounts}
            hint={accounts ? t('serverdetail.stats.wordpress', { count: wordpressCount }) : t('serverdetail.stats.notLoaded')}
          />
        </div>
        <div className="motion-safe:animate-rise stagger" style={stagger(2)}>
          <Stat
            label={t('serverdetail.stats.databases')}
            value={accounts ? totalDatabases : EMPTY}
            icon={CircleStackIcon}
            tone="violet"
            loading={loadingAccounts && !accounts}
            quiet={!accounts}
            hint={accounts ? t('serverdetail.stats.databasesHint') : t('serverdetail.stats.notLoaded')}
          />
        </div>
        <div className="motion-safe:animate-rise stagger" style={stagger(3)}>
          <Stat
            label={t('serverdetail.stats.disk')}
            value={serverInfo?.used_disk ? <Mono>{serverInfo.used_disk}</Mono> : EMPTY}
            icon={ServerStackOutlineIcon}
            tone={serverInfo?.used_disk ? 'brand' : 'neutral'}
            quiet={!serverInfo?.used_disk}
            hint={
              serverInfo?.total_disk
                ? t.rich('serverdetail.stats.diskOf', { total: <Mono className="text-xs">{serverInfo.total_disk}</Mono> })
                : t('serverdetail.stats.testToLoad')
            }
          />
        </div>
        <div className="motion-safe:animate-rise stagger" style={stagger(4)}>
          <Stat
            label={t('serverdetail.stats.webServer')}
            value={serverInfo?.web_server ? <Mono className="text-xl">{serverInfo.web_server}</Mono> : EMPTY}
            icon={CpuChipIcon}
            tone={serverInfo?.web_server ? 'orange' : 'neutral'}
            quiet={!serverInfo?.web_server}
            hint={
              serverInfo?.os_version ? (
                <span title={serverInfo.os_version}>
                  <Mono className="text-xs">{serverInfo.os_version}</Mono>
                </span>
              ) : (
                t('serverdetail.stats.testToLoad')
              )
            }
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="motion-safe:animate-rise stagger" style={stagger(5)}>
          <CardHeader
            actions={
              <Button size="sm" variant="ghost" leftIcon={<PencilIcon />} onClick={() => setIsEditModalOpen(true)}>
                {t('common.edit')}
              </Button>
            }
          >
            <CardTitle>{t('serverdetail.connection.title')}</CardTitle>
            <CardDescription>{t('serverdetail.connection.description')}</CardDescription>
          </CardHeader>
          <KeyValue
            layout="grid"
            columns={3}
            items={[
              { label: t('serverdetail.connection.host'), value: server.host, mono: true },
              { label: t('serverdetail.connection.port'), value: server.port, mono: true },
              { label: t('serverdetail.connection.username'), value: server.username, mono: true },
              { label: t('serverdetail.connection.auth'), value: t(`auth.${server.auth_method}`) },
              { label: t('serverdetail.connection.panel'), value: <PanelBadge panelType={server.panel_type} size="sm" /> },
              ...(server.auth_method === 'ssh_key'
                ? [{ label: t('serverdetail.connection.sshKey'), value: sshKeyName ?? server.ssh_key_id, mono: !sshKeyName }]
                : []),
              ...(server.api_endpoint ? [{ label: t('serverdetail.connection.apiEndpoint'), value: server.api_endpoint, mono: true, span: true }] : []),
              ...(server.enhance_org_id ? [{ label: t('serverdetail.connection.enhanceOrg'), value: server.enhance_org_id, mono: true, span: true }] : []),
            ]}
          />
          {server.auth_method !== 'api_key' && (
            <div className="mt-6">
              <p className="eyebrow mb-1.5">{t('serverdetail.connection.sshCommand')}</p>
              <CodeBlock language="ssh" code={`ssh -p ${server.port} ${server.username}@${server.host}`} />
            </div>
          )}
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            <span title={formatDate(server.created_at)}>{t('serverdetail.connection.addedAt', { time: formatRelativeTime(server.created_at) })}</span>
          </p>
        </Card>

        <Card className="motion-safe:animate-rise stagger" style={stagger(6)}>
          <CardHeader
            actions={
              hasSystemInfo ? (
                <Button size="sm" variant="ghost" leftIcon={<ArrowPathIcon />} onClick={handleTestConnection} loading={testing}>
                  {t('serverdetail.actions.reload')}
                </Button>
              ) : undefined
            }
          >
            <CardTitle>{t('serverdetail.system.title')}</CardTitle>
            <CardDescription>{t('serverdetail.system.description')}</CardDescription>
          </CardHeader>
          {hasSystemInfo ? (
            <div className="space-y-5">
              {phpVersions.length > 0 && (
                <div>
                  <p className="eyebrow mb-1.5">{t('serverdetail.system.php')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {phpVersions.map((v) => (
                      <Badge key={v} tone="info" mono dir="ltr">
                        PHP {v}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {(serverInfo?.os_version || serverInfo?.web_server) && (
                <KeyValue
                  layout="grid"
                  columns={2}
                  items={[
                    { label: t('serverdetail.system.os'), value: serverInfo?.os_version, mono: true, span: true },
                    { label: t('serverdetail.system.webServer'), value: serverInfo?.web_server, mono: true },
                  ]}
                />
              )}
              {serverInfo?.total_disk && (
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="eyebrow">{t('serverdetail.system.disk')}</p>
                    {diskPercent !== null && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">{t('serverdetail.system.diskUsage', { percent: diskPercent })}</span>
                    )}
                  </div>
                  <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    <Mono>
                      {serverInfo.used_disk ?? '?'}
                      <span className="mx-1.5 text-sm font-normal text-slate-400 dark:text-slate-500">/</span>
                      <span className="text-sm font-normal text-slate-500 dark:text-slate-400">{serverInfo.total_disk}</span>
                    </Mono>
                  </p>
                  {diskPercent !== null && <ProgressBar className="mt-2" value={diskPercent} tone={diskTone} size="sm" label={t('serverdetail.system.disk')} />}
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              size="sm"
              illustration="system"
              title={t('serverdetail.system.empty.title')}
              description={
                <>
                  <p>{t('serverdetail.system.empty.lead')}</p>
                  <ul className="mt-2 space-y-1 text-start">
                    <li className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                      {t('serverdetail.system.empty.b1')}
                    </li>
                    <li className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                      {t('serverdetail.system.empty.b2')}
                    </li>
                    <li className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                      {t('serverdetail.system.empty.b3')}
                    </li>
                  </ul>
                </>
              }
              action={
                <Button size="sm" variant="secondary" leftIcon={<SignalIcon />} onClick={handleTestConnection} loading={testing}>
                  {t('serverdetail.actions.test')}
                </Button>
              }
            />
          )}
        </Card>
      </div>

      <Card flush className="motion-safe:animate-rise stagger" style={stagger(7)}>
        <CardHeader
          divided
          actions={
            hasAccounts ? (
              <Input
                size="sm"
                type="search"
                aria-label={t('serverdetail.accounts.searchLabel')}
                leftIcon={<MagnifyingGlassIcon />}
                placeholder={t('serverdetail.accounts.search')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full sm:w-72"
              />
            ) : undefined
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{t('serverdetail.accounts.title')}</CardTitle>
            {accounts && (
              <Badge tone="neutral" size="sm">
                {searchTerm ? t('serverdetail.accounts.countOf', { shown: filteredAndSortedAccounts.length, total: accounts.total }) : accounts.total}
              </Badge>
            )}
            {accountsSource && !loadingAccounts && (
              <Badge
                tone={accountsSource.kind === 'refreshed' ? 'success' : 'neutral'}
                size="sm"
                dot
                title={formatDate(accountsSource.at)}
              >
                {accountsSource.kind === 'refreshed'
                  ? t('serverdetail.accounts.refreshed', { time: formatRelativeTime(accountsSource.at) })
                  : t('serverdetail.accounts.cached')}
              </Badge>
            )}
            {loadingAccounts && (
              <Badge tone="info" size="sm" dot pulse>
                {t('serverdetail.accounts.loading')}
              </Badge>
            )}
          </div>
          {hasAccounts && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
              <Badge tone="neutral" size="sm">
                {t('serverdetail.accounts.facts.wordpress', { count: wordpressCount })}
              </Badge>
              <Badge tone="neutral" size="sm">
                {t('serverdetail.accounts.facts.ssl', { count: sslCount })}
              </Badge>
              <Badge tone={suspendedCount > 0 ? 'warning' : 'neutral'} size="sm">
                {t('serverdetail.accounts.facts.suspended', { count: suspendedCount })}
              </Badge>
            </div>
          )}
        </CardHeader>

        {loadingAccounts ? (
          <SkeletonTable rows={6} columns={8} />
        ) : !hasAccounts ? (
          <EmptyState
            illustration="accounts"
            title={t('serverdetail.accounts.empty.title')}
            description={
              <>
                <p>{t('serverdetail.accounts.empty.lead')}</p>
                <ul className="mt-2 space-y-1 text-start">
                  <li className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                    {t('serverdetail.accounts.empty.b1')}
                  </li>
                  <li className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                    {t('serverdetail.accounts.empty.b2')}
                  </li>
                  <li className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                    {t('serverdetail.accounts.empty.b3')}
                  </li>
                </ul>
              </>
            }
            action={
              <Button variant="primary" leftIcon={<ArrowPathIcon />} onClick={handleRefreshAccounts} loading={loadingAccounts}>
                {t('serverdetail.actions.refresh')}
              </Button>
            }
          />
        ) : filteredAndSortedAccounts.length === 0 ? (
          <EmptyState
            size="sm"
            illustration="search"
            title={t('serverdetail.accounts.noMatch.title')}
            description={t.rich('serverdetail.accounts.noMatch.description', { query: <Mono className="text-[13px]">{searchTerm}</Mono> })}
            action={
              <Button variant="secondary" size="sm" onClick={() => setSearchTerm('')}>
                {t('serverdetail.accounts.clearSearch')}
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
