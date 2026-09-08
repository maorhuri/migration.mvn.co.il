import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ServerStackIcon,
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { getServers, getMigrations } from '../api/client';
import type { Server, Migration } from '../types';

export default function Dashboard() {
  const [servers, setServers] = useState<Server[]>([]);
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [serversData, migrationsData] = await Promise.all([
          getServers(),
          getMigrations(),
        ]);
        setServers(serversData);
        setMigrations(migrationsData);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const stats = {
    totalServers: servers.length,
    directAdminServers: servers.filter(s => s.panel_type === 'directadmin').length,
    enhanceServers: servers.filter(s => s.panel_type === 'enhance').length,
    totalMigrations: migrations.length,
    completedMigrations: migrations.filter(m => m.status === 'completed').length,
    runningMigrations: migrations.filter(m => m.status === 'running').length,
    failedMigrations: migrations.filter(m => m.status === 'failed').length,
  };

  const recentMigrations = migrations.slice(0, 5);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Overview of your migration system</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="card">
          <div className="flex items-center">
            <div className="p-3 bg-blue-100 rounded-lg">
              <ServerStackIcon className="w-6 h-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-600">Total Servers</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalServers}</p>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-500">
            {stats.directAdminServers} DirectAdmin, {stats.enhanceServers} Enhance
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-3 bg-green-100 rounded-lg">
              <CheckCircleIcon className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-600">Completed</p>
              <p className="text-2xl font-bold text-gray-900">{stats.completedMigrations}</p>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-500">
            Successful migrations
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-3 bg-yellow-100 rounded-lg">
              <ClockIcon className="w-6 h-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-600">Running</p>
              <p className="text-2xl font-bold text-gray-900">{stats.runningMigrations}</p>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-500">
            In progress
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-3 bg-red-100 rounded-lg">
              <ExclamationCircleIcon className="w-6 h-6 text-red-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm text-gray-600">Failed</p>
              <p className="text-2xl font-bold text-gray-900">{stats.failedMigrations}</p>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-500">
            Need attention
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Link
          to="/migrations/new"
          className="card hover:border-primary-500 hover:shadow-md transition-all group"
        >
          <div className="flex items-center">
            <div className="p-3 bg-primary-100 rounded-lg group-hover:bg-primary-200 transition-colors">
              <ArrowsRightLeftIcon className="w-6 h-6 text-primary-600" />
            </div>
            <div className="ml-4">
              <p className="font-semibold text-gray-900">Start New Migration</p>
              <p className="text-sm text-gray-600">Migrate an account between servers</p>
            </div>
          </div>
        </Link>

        <Link
          to="/servers"
          className="card hover:border-primary-500 hover:shadow-md transition-all group"
        >
          <div className="flex items-center">
            <div className="p-3 bg-primary-100 rounded-lg group-hover:bg-primary-200 transition-colors">
              <ServerStackIcon className="w-6 h-6 text-primary-600" />
            </div>
            <div className="ml-4">
              <p className="font-semibold text-gray-900">Add Server</p>
              <p className="text-sm text-gray-600">Connect a new server to the system</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Recent Migrations */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Migrations</h2>
          <Link to="/migrations" className="text-primary-600 hover:text-primary-700 text-sm font-medium">
            View all
          </Link>
        </div>

        {recentMigrations.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No migrations yet</p>
        ) : (
          <div className="space-y-3">
            {recentMigrations.map((migration) => (
              <Link
                key={migration.id}
                to={`/migrations/${migration.id}`}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center">
                  <div className={`w-2 h-2 rounded-full mr-3 ${
                    migration.status === 'completed' ? 'bg-green-500' :
                    migration.status === 'running' ? 'bg-yellow-500' :
                    migration.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'
                  }`} />
                  <div>
                    <p className="font-medium text-gray-900">{migration.account_username}</p>
                    <p className="text-sm text-gray-500">
                      {migration.current_step || migration.status}
                    </p>
                  </div>
                </div>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                  migration.status === 'completed' ? 'bg-green-100 text-green-700' :
                  migration.status === 'running' ? 'bg-yellow-100 text-yellow-700' :
                  migration.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {migration.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
