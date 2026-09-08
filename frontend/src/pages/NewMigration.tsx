import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { getServers, checkCompatibility, startMigration, getServerAccounts } from '../api/client';
import type { Server, Account, CompatibilityResult } from '../types';

export default function NewMigration() {
  const navigate = useNavigate();
  const [servers, setServers] = useState<Server[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [compatibility, setCompatibility] = useState<CompatibilityResult | null>(null);

  const [formData, setFormData] = useState({
    source_server_id: '',
    target_server_id: '',
    username: '',
    new_password: '',
  });

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const data = await getServers();
        setServers(data);
      } catch (error) {
        toast.error('Failed to fetch servers');
      } finally {
        setLoading(false);
      }
    };
    fetchServers();
  }, []);

  useEffect(() => {
    if (formData.source_server_id) {
      const fetchAccounts = async () => {
        try {
          const data = await getServerAccounts(formData.source_server_id);
          setAccounts(data);
        } catch (error) {
          console.error('Failed to fetch accounts:', error);
          setAccounts([]);
        }
      };
      fetchAccounts();
    } else {
      setAccounts([]);
    }
  }, [formData.source_server_id]);

  const handleCheckCompatibility = async () => {
    if (!formData.source_server_id || !formData.target_server_id || !formData.username) {
      toast.error('Please fill in all required fields');
      return;
    }

    setChecking(true);
    try {
      const result = await checkCompatibility({
        source_server_id: formData.source_server_id,
        target_server_id: formData.target_server_id,
        username: formData.username,
      });
      setCompatibility(result);
    } catch (error) {
      toast.error('Failed to check compatibility');
    } finally {
      setChecking(false);
    }
  };

  const handleStartMigration = async () => {
    if (!formData.source_server_id || !formData.target_server_id || !formData.username) {
      toast.error('Please fill in all required fields');
      return;
    }

    setStarting(true);
    try {
      const migration = await startMigration(formData);
      toast.success('Migration started!');
      navigate(`/migrations/${migration.id}`);
    } catch (error) {
      toast.error('Failed to start migration');
    } finally {
      setStarting(false);
    }
  };

  const sourceServers = servers.filter(s => s.panel_type === 'directadmin' || s.panel_type === 'cpanel');
  const targetServers = servers.filter(s => s.panel_type === 'enhance' && s.id !== formData.source_server_id);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">New Migration</h1>
        <p className="text-gray-600">Migrate an account from one server to another</p>
      </div>

      <div className="card">
        <div className="space-y-6">
          {/* Source Server */}
          <div>
            <label className="label">Source Server (DirectAdmin/cPanel)</label>
            <select
              className="input"
              value={formData.source_server_id}
              onChange={(e) => {
                setFormData({ ...formData, source_server_id: e.target.value, username: '' });
                setCompatibility(null);
              }}
            >
              <option value="">Select source server</option>
              {sourceServers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name} ({server.panel_type})
                </option>
              ))}
            </select>
            {sourceServers.length === 0 && (
              <p className="text-sm text-yellow-600 mt-1">
                No DirectAdmin or cPanel servers configured. Please add a source server first.
              </p>
            )}
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <div className="p-3 bg-gray-100 rounded-full">
              <ArrowRightIcon className="w-6 h-6 text-gray-400" />
            </div>
          </div>

          {/* Target Server */}
          <div>
            <label className="label">Target Server (Enhance)</label>
            <select
              className="input"
              value={formData.target_server_id}
              onChange={(e) => {
                setFormData({ ...formData, target_server_id: e.target.value });
                setCompatibility(null);
              }}
            >
              <option value="">Select target server</option>
              {targetServers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name} ({server.panel_type})
                </option>
              ))}
            </select>
            {targetServers.length === 0 && (
              <p className="text-sm text-yellow-600 mt-1">
                No Enhance servers configured. Please add a target server first.
              </p>
            )}
          </div>

          {/* Account */}
          <div>
            <label className="label">Account to Migrate</label>
            {accounts.length > 0 ? (
              <select
                className="input"
                value={formData.username}
                onChange={(e) => {
                  setFormData({ ...formData, username: e.target.value });
                  setCompatibility(null);
                }}
              >
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.username} value={account.username}>
                    {account.username} ({account.domain})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="input"
                value={formData.username}
                onChange={(e) => {
                  setFormData({ ...formData, username: e.target.value });
                  setCompatibility(null);
                }}
                placeholder="Enter username"
              />
            )}
          </div>

          {/* New Password */}
          <div>
            <label className="label">New Password (Optional)</label>
            <input
              type="password"
              className="input"
              value={formData.new_password}
              onChange={(e) => setFormData({ ...formData, new_password: e.target.value })}
              placeholder="Leave empty to generate random password"
            />
            <p className="text-sm text-gray-500 mt-1">
              Password for the new account on the target server
            </p>
          </div>

          {/* Compatibility Check */}
          {compatibility && (
            <div className={`p-4 rounded-lg ${
              compatibility.compatible ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
            }`}>
              <div className="flex items-center mb-2">
                {compatibility.compatible ? (
                  <CheckCircleIcon className="w-5 h-5 text-green-500 mr-2" />
                ) : (
                  <XCircleIcon className="w-5 h-5 text-red-500 mr-2" />
                )}
                <span className={`font-medium ${compatibility.compatible ? 'text-green-700' : 'text-red-700'}`}>
                  {compatibility.compatible ? 'Migration is compatible' : 'Migration is not compatible'}
                </span>
              </div>

              {compatibility.warnings && compatibility.warnings.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-yellow-700 flex items-center">
                    <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
                    Warnings:
                  </p>
                  <ul className="mt-1 text-sm text-yellow-600 list-disc list-inside">
                    {compatibility.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {compatibility.errors && compatibility.errors.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-red-700">Errors:</p>
                  <ul className="mt-1 text-sm text-red-600 list-disc list-inside">
                    {compatibility.errors.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              onClick={handleCheckCompatibility}
              disabled={checking || !formData.source_server_id || !formData.target_server_id || !formData.username}
              className="btn btn-secondary"
            >
              {checking ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-600"></div>
              ) : (
                'Check Compatibility'
              )}
            </button>
            <button
              onClick={handleStartMigration}
              disabled={starting || !formData.source_server_id || !formData.target_server_id || !formData.username}
              className="btn btn-primary"
            >
              {starting ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                'Start Migration'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
