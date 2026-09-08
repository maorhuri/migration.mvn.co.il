import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PlusIcon,
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { getMigrations, getServers } from '../api/client';
import type { Migration, Server } from '../types';

export default function Migrations() {
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [servers, setServers] = useState<Record<string, Server>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [migrationsData, serversData] = await Promise.all([
          getMigrations(),
          getServers(),
        ]);
        setMigrations(migrationsData);
        
        const serversMap: Record<string, Server> = {};
        serversData.forEach((s) => {
          serversMap[s.id] = s;
        });
        setServers(serversMap);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const getStatusIcon = (status: Migration['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircleIcon className="w-5 h-5 text-red-500" />;
      case 'running':
        return <ClockIcon className="w-5 h-5 text-yellow-500 animate-pulse" />;
      default:
        return <ClockIcon className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: Migration['status']) => {
    const classes = {
      completed: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
      running: 'bg-yellow-100 text-yellow-700',
      pending: 'bg-gray-100 text-gray-700',
    };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${classes[status]}`}>
        {status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Migrations</h1>
          <p className="text-gray-600">View and manage account migrations</p>
        </div>
        <Link to="/migrations/new" className="btn btn-primary flex items-center">
          <PlusIcon className="w-5 h-5 mr-2" />
          New Migration
        </Link>
      </div>

      {migrations.length === 0 ? (
        <div className="card text-center py-12">
          <ArrowsRightLeftIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No migrations yet</h3>
          <p className="text-gray-500 mb-4">Start your first migration to transfer accounts between servers</p>
          <Link to="/migrations/new" className="btn btn-primary">
            Start Migration
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Account
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Source
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Target
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Progress
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Started
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {migrations.map((migration) => (
                <tr key={migration.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link
                      to={`/migrations/${migration.id}`}
                      className="text-primary-600 hover:text-primary-700 font-medium"
                    >
                      {migration.account_username}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {servers[migration.source_server_id]?.name || 'Unknown'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {servers[migration.target_server_id]?.name || 'Unknown'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {getStatusIcon(migration.status)}
                      <span className="ml-2">{getStatusBadge(migration.status)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {migration.status === 'running' && (
                      <div className="w-32">
                        <div className="flex items-center">
                          <div className="flex-1 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-primary-600 h-2 rounded-full transition-all"
                              style={{
                                width: `${migration.total_steps > 0 
                                  ? (migration.completed_steps / migration.total_steps) * 100 
                                  : 0}%`
                              }}
                            />
                          </div>
                          <span className="ml-2 text-xs text-gray-500">
                            {migration.completed_steps}/{migration.total_steps}
                          </span>
                        </div>
                        {migration.current_step && (
                          <p className="text-xs text-gray-500 mt-1 truncate">
                            {migration.current_step}
                          </p>
                        )}
                      </div>
                    )}
                    {migration.status === 'completed' && (
                      <span className="text-sm text-green-600">Complete</span>
                    )}
                    {migration.status === 'failed' && (
                      <span className="text-sm text-red-600 truncate max-w-xs block">
                        {migration.error || 'Failed'}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {migration.started_at 
                      ? new Date(migration.started_at).toLocaleString()
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
