import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { Button, PageHeader, Sparkline, Stat } from '../components/ui';
import { useT } from '../lib/i18n';
import { realDate } from '../lib/format';
import { RecentMigrations } from '../components/dashboard/RecentMigrations';
import { FleetList } from '../components/dashboard/FleetList';
import { AttentionCard } from '../components/dashboard/AttentionCard';
import { GettingStartedCard } from '../components/dashboard/GettingStartedCard';

const TREND_DAYS = 14;
const DAY_MS = 86_400_000;

/** Completed migrations per local calendar day over the last `TREND_DAYS` days (oldest first). */
function completedPerDay(migrations: Migration[], now = new Date()): number[] {
  const counts = new Array<number>(TREND_DAYS).fill(0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const m of migrations) {
    if (m.status !== 'completed') continue;
    const when = new Date(realDate(m.completed_at) ?? m.created_at);
    if (Number.isNaN(when.getTime())) continue;
    const day = new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
    const ago = Math.round((today - day) / DAY_MS);
    if (ago >= 0 && ago < TREND_DAYS) counts[TREND_DAYS - 1 - ago] += 1;
  }
  return counts;
}

/**
 * Stat hints may wrap to a second line on narrow tiles instead of truncating.
 * `ltr` isolates an all-Latin hint ("1 DirectAdmin · 1 Enhance") so its digits keep their order in Hebrew.
 */
function Hint({ children, ltr }: { children: string; ltr?: boolean }) {
  return <span className="block whitespace-normal text-balance">{ltr ? <bdi dir="ltr">{children}</bdi> : children}</span>;
}

export default function Dashboard() {
  const t = useT();
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
    migrationsWithWarnings: migrations.filter(m => (m.warnings ?? 0) > 0).length,
  };

  const trend = useMemo(() => completedPerDay(migrations), [migrations]);
  const completedRecently = useMemo(() => trend.reduce((sum, n) => sum + n, 0), [trend]);

  const recentMigrations = migrations.slice(0, 5);
  /** The API failed and nothing is cached: the tiles must not read as "no servers connected yet". */
  const unavailable = !loading && error && servers.length === 0 && migrations.length === 0;
  const showGettingStarted = !loading && !unavailable && servers.length < 2;
  const hint = (node: ReactNode): ReactNode => (loading ? undefined : unavailable ? <Hint>{t('dashboard.stats.unavailable')}</Hint> : node);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        actions={
          <>
            <Button variant="secondary" leftIcon={<PlusIcon />} onClick={() => navigate('/servers')}>
              {t('dashboard.addServer')}
            </Button>
            <Button variant="primary" leftIcon={<ArrowsRightLeftIcon />} onClick={() => navigate('/migrations/new')}>
              {t('nav.newMigration')}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Stat
          className="motion-safe:animate-rise stagger [--i:1]"
          label={t('dashboard.stats.servers')}
          value={stats.totalServers}
          icon={ServerStackIcon}
          tone="brand"
          loading={loading}
          quiet={stats.totalServers === 0}
          hint={hint(
            stats.totalServers === 0
              ? <Hint>{t('dashboard.stats.serversNone')}</Hint>
              : <Hint ltr>{t('dashboard.stats.serversHint', { da: stats.directAdminServers, en: stats.enhanceServers })}</Hint>,
          )}
        />
        <Stat
          className="motion-safe:animate-rise stagger [--i:2]"
          label={t('dashboard.stats.running')}
          value={stats.runningMigrations}
          icon={ArrowsRightLeftIcon}
          tone="brand"
          loading={loading}
          quiet={stats.runningMigrations === 0}
          valueClassName={stats.runningMigrations > 0 ? 'text-gradient-brand' : undefined}
          hint={hint(
            stats.runningMigrations > 0
              ? <Hint>{t('dashboard.stats.runningLive', { count: stats.runningMigrations })}</Hint>
              : <Hint>{t('dashboard.stats.runningIdle', { total: t('units.migrations', { count: stats.totalMigrations }) })}</Hint>,
          )}
        />
        <Stat
          className="motion-safe:animate-rise stagger [--i:3]"
          label={t('dashboard.stats.completed')}
          value={stats.completedMigrations}
          icon={CheckCircleIcon}
          tone="success"
          loading={loading}
          quiet={stats.completedMigrations === 0}
          trend={completedRecently > 0 ? <Sparkline values={trend} className="h-7 w-20 text-emerald-500" /> : undefined}
          hint={hint(
            completedRecently > 0
              ? <Hint>{t('dashboard.stats.completedHint', { count: completedRecently })}</Hint>
              : <Hint>{t('dashboard.stats.completedNone')}</Hint>,
          )}
        />
        <Stat
          className="motion-safe:animate-rise stagger [--i:4]"
          label={t('dashboard.stats.failed')}
          value={stats.failedMigrations}
          icon={ExclamationCircleIcon}
          tone={stats.failedMigrations > 0 ? 'danger' : 'neutral'}
          loading={loading}
          quiet={stats.failedMigrations === 0}
          hint={hint(<Hint>{stats.failedMigrations > 0 ? t('dashboard.stats.failedHint') : t('dashboard.stats.failedNone')}</Hint>)}
        />
        <Stat
          className="motion-safe:animate-rise stagger [--i:5]"
          label={t('dashboard.stats.warnings')}
          value={stats.warnings}
          icon={ExclamationTriangleIcon}
          tone={stats.warnings > 0 ? 'warning' : 'neutral'}
          loading={loading}
          quiet={stats.warnings === 0}
          hint={hint(
            stats.warnings > 0
              ? <Hint>{t('dashboard.stats.warningsHint', { count: stats.migrationsWithWarnings })}</Hint>
              : <Hint>{t('dashboard.stats.warningsNone')}</Hint>,
          )}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <AttentionCard
          className="motion-safe:animate-rise stagger [--i:6] xl:col-span-2"
          migrations={migrations}
          loading={loading}
          error={error}
          onRetry={fetchData}
        />
        <FleetList
          className="motion-safe:animate-rise stagger [--i:7]"
          servers={servers}
          migrations={migrations}
          loading={loading}
          error={error}
          onRetry={fetchData}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <RecentMigrations
          className={showGettingStarted ? 'motion-safe:animate-rise stagger [--i:8] xl:col-span-2' : 'motion-safe:animate-rise stagger [--i:8] xl:col-span-3'}
          migrations={recentMigrations}
          servers={servers}
          loading={loading}
          error={error}
          onRetry={fetchData}
        />
        {showGettingStarted && <GettingStartedCard className="motion-safe:animate-rise stagger [--i:9]" servers={servers} />}
      </div>
    </div>
  );
}
