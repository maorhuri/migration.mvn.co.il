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

/** Panel types offered in the source/target type filter (labels are translation keys). */
export const PANEL_FILTER_OPTIONS = [
  { id: 'all', labelKey: 'newmigration.filter.all' },
  { id: 'directadmin', labelKey: 'panel.directadmin' },
  { id: 'enhance', labelKey: 'panel.enhance' },
  { id: 'cpanel', labelKey: 'panel.cpanel' },
  { id: 'cloudpanel', labelKey: 'panel.cloudpanel' },
] as const;
