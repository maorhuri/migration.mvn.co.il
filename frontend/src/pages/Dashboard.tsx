import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ServerStackIcon,
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { PlusIcon } from '@heroicons/react/20/solid';
import { getServers, getMigrations } from '../api/client';
import type { Server, Migration } from '../types';
import { Button, PageHeader, Stat } from '../components/ui';
import { RecentMigrations } from '../components/dashboard/RecentMigrations';
import { FleetList } from '../components/dashboard/FleetList';

export default function Dashboard() {
  const navigate = useNavigate();
  const [servers, setServers] = useState<Server[]>([]);
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [serversData, migrationsData] = await Promise.all([
        getServers(),
        getMigrations(),
      ]);
      setServers(serversData);
      setMigrations(migrationsData);
      setError(false);
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const stats = {
    totalServers: servers.length,
    directAdminServers: servers.filter(s => s.panel_type === 'directadmin').length,
    enhanceServers: servers.filter(s => s.panel_type === 'enhance').length,
    totalMigrations: migrations.length,
    completedMigrations: migrations.filter(m => m.status === 'completed').length,
    runningMigrations: migrations.filter(m => m.status === 'running').length,
    failedMigrations: migrations.filter(m => m.status === 'failed').length,
    warnings: migrations.reduce((sum, m) => sum + (m.warnings ?? 0), 0),
  };

  const recentMigrations = migrations.slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of servers and migrations across the fleet."
        actions={
          <>
            <Button variant="secondary" leftIcon={<PlusIcon />} onClick={() => navigate('/servers')}>
              Add server
            </Button>
            <Button variant="primary" leftIcon={<ArrowsRightLeftIcon />} onClick={() => navigate('/migrations/new')}>
              New migration
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Servers"
          value={stats.totalServers}
          icon={ServerStackIcon}
          tone="brand"
          loading={loading}
          hint={loading ? undefined : `${stats.directAdminServers} DirectAdmin · ${stats.enhanceServers} Enhance`}
        />
        <Stat
          label="Running"
          value={stats.runningMigrations}
          icon={ArrowsRightLeftIcon}
          tone="info"
          loading={loading}
          hint={loading ? undefined : `${stats.totalMigrations} total migrations`}
        />
        <Stat
          label="Completed"
          value={stats.completedMigrations}
          icon={CheckCircleIcon}
          tone="success"
          loading={loading}
          hint="Successful migrations"
        />
        <Stat
          label="Failed"
          value={stats.failedMigrations}
          icon={ExclamationCircleIcon}
          tone="danger"
          loading={loading}
          hint={stats.failedMigrations > 0 ? 'Need attention' : 'Nothing to review'}
        />
        <Stat
          label="Warnings"
          value={stats.warnings}
          icon={ExclamationTriangleIcon}
          tone="warning"
          loading={loading}
          hint="Across all migrations"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <RecentMigrations
          migrations={recentMigrations}
          servers={servers}
          loading={loading}
          error={error}
          onRetry={fetchData}
        />
        <FleetList servers={servers} loading={loading} error={error} onRetry={fetchData} />
      </div>
    </div>
  );
}
