/** Wizard phases of the New Migration page. */
export type MigrationStep = 'select_source' | 'select_accounts' | 'select_target' | 'review' | 'migrating' | 'completed';

/** One row of the live migration step list. */
export interface MigrationStepStatus {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'warning';
  details?: string;
  error?: string;
  duration?: number;
}

/** Panel types offered in the source/target type filter. */
export const PANEL_FILTER_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'directadmin', label: 'DirectAdmin' },
  { id: 'enhance', label: 'Enhance' },
  { id: 'cpanel', label: 'cPanel' },
  { id: 'cloudpanel', label: 'CloudPanel' },
] as const;
