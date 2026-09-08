import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { getMigration, getMigrationLogs, getServer } from '../api/client';
import type { Migration, MigrationLog, Server } from '../types';

export default function MigrationDetail() {
  const { id } = useParams<{ id: string }>();
  const [migration, setMigration] = useState<Migration | null>(null);
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [sourceServer, setSourceServer] = useState<Server | null>(null);
  const [targetServer, setTargetServer] = useState<Server | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!id) return;
    try {
      const [migrationData, logsData] = await Promise.all([
        getMigration(id),
        getMigrationLogs(id),
      ]);
      setMigration(migrationData);
      setLogs(logsData);

      // Fetch server details
      if (migrationData.source_server_id) {
        const source = await getServer(migrationData.source_server_id);
        setSourceServer(source);
      }
      if (migrationData.target_server_id) {
        const target = await getServer(migrationData.target_server_id);
        setTargetServer(target);
      }
    } catch (error) {
      console.error('Failed to fetch migration:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Auto-refresh for running migrations
    const interval = setInterval(() => {
      if (migration?.status === 'running') {
        fetchData();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [id, migration?.status]);

  const getStatusIcon = (status: Migration['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="w-8 h-8 text-green-500" />;
      case 'failed':
        return <XCircleIcon className="w-8 h-8 text-red-500" />;
      case 'running':
        return <ClockIcon className="w-8 h-8 text-yellow-500 animate-pulse" />;
      default:
        return <ClockIcon className="w-8 h-8 text-gray-400" />;
    }
  };

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-600 bg-red-50';
      case 'warn':
        return 'text-yellow-600 bg-yellow-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!migration) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Migration not found</h2>
        <Link to="/migrations" className="text-primary-600 hover:text-primary-700 mt-2 inline-block">
          Back to migrations
        </Link>
      </div>
    );
  }

  const progress = migration.total_steps > 0 
    ? (migration.completed_steps / migration.total_steps) * 100 
    : 0;

  return (
    <div>
      <Link
        to="/migrations"
        className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeftIcon className="w-4 h-4 mr-2" />
        Back to migrations
      </Link>

      {/* Header */}
      <div className="card mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center">
            {getStatusIcon(migration.status)}
            <div className="ml-4">
              <h1 className="text-2xl font-bold text-gray-900">
                {migration.account_username}
              </h1>
              <p className="text-gray-500">
                Migration ID: {migration.id}
              </p>
            </div>
          </div>
          <button
            onClick={fetchData}
            className="btn btn-secondary flex items-center"
          >
            <ArrowPathIcon className="w-4 h-4 mr-2" />
            Refresh
          </button>
        </div>

        {/* Progress */}
        {migration.status === 'running' && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                {migration.current_step || 'Processing...'}
              </span>
              <span className="text-sm text-gray-500">
                {migration.completed_steps}/{migration.total_steps} steps
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-primary-600 h-3 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            {migration.bytes_transferred > 0 && (
              <p className="text-sm text-gray-500 mt-2">
                Transferred: {formatBytes(migration.bytes_transferred)}
                {migration.total_bytes > 0 && ` / ${formatBytes(migration.total_bytes)}`}
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {migration.status === 'failed' && migration.error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 font-medium">Error</p>
            <p className="text-red-600 mt-1">{migration.error}</p>
          </div>
        )}

        {/* Success */}
        {migration.status === 'completed' && (
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-700 font-medium">Migration completed successfully!</p>
            <p className="text-green-600 mt-1">
              The account has been migrated to the target server.
            </p>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Source Server</h3>
          {sourceServer ? (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Name</span>
                <span className="text-gray-900">{sourceServer.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Type</span>
                <span className="text-gray-900 capitalize">{sourceServer.panel_type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Host</span>
                <span className="text-gray-900">{sourceServer.host}</span>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">Server details not available</p>
          )}
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Target Server</h3>
          {targetServer ? (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Name</span>
                <span className="text-gray-900">{targetServer.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Type</span>
                <span className="text-gray-900 capitalize">{targetServer.panel_type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Host</span>
                <span className="text-gray-900">{targetServer.host}</span>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">Server details not available</p>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Migration Log</h3>
        
        {logs.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No logs yet</p>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`p-3 rounded-lg ${getLogLevelColor(log.level)}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className={`text-xs font-medium uppercase ${
                      log.level === 'error' ? 'text-red-700' :
                      log.level === 'warn' ? 'text-yellow-700' : 'text-gray-700'
                    }`}>
                      {log.level}
                    </span>
                    <p className="mt-1">{log.message}</p>
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap ml-4">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
