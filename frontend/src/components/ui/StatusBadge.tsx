import { Badge, type BadgeProps, type BadgeTone } from './Badge';
import { useT } from '../../lib/i18n';

export type MigrationStatus = 'pending' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';
export type ConnectionStatus = 'unknown' | 'testing' | 'success' | 'failed' | 'connected' | 'disconnected';
export type StepStatus = 'pending' | 'running' | 'completed' | 'error' | 'warning' | 'skipped';
export type AccountStatus = 'active' | 'suspended';
export type AnyStatus = MigrationStatus | ConnectionStatus | StepStatus | AccountStatus | (string & {});

export interface StatusBadgeProps extends Omit<BadgeProps, 'tone' | 'dot' | 'pulse' | 'children'> {
  status: AnyStatus;
  /** Override the auto label. */
  label?: string;
}

interface StatusMeta {
  tone: BadgeTone;
  /** English fallback label; the component renders t(`status.${key}`). */
  label: string;
  pulse?: boolean;
}

export const STATUS_META: Record<string, StatusMeta> = {
  // Migration
  pending: { tone: 'neutral', label: 'Pending' },
  running: { tone: 'brand', label: 'Running', pulse: true },
  awaiting_review: { tone: 'warning', label: 'Needs review', pulse: true },
  completed: { tone: 'success', label: 'Completed' },
  failed: { tone: 'danger', label: 'Failed' },
  cancelled: { tone: 'warning', label: 'Cancelled' },
  skipped: { tone: 'neutral', label: 'Skipped' },
  // Steps
  error: { tone: 'danger', label: 'Error' },
  warning: { tone: 'warning', label: 'Warning' },
  // Server connection tests
  unknown: { tone: 'neutral', label: 'Not tested' },
  testing: { tone: 'info', label: 'Testing', pulse: true },
  success: { tone: 'success', label: 'Connected' },
  connected: { tone: 'success', label: 'Connected' },
  disconnected: { tone: 'danger', label: 'Disconnected' },
  // Cluster nodes / accounts
  online: { tone: 'success', label: 'Online' },
  offline: { tone: 'danger', label: 'Offline' },
  active: { tone: 'success', label: 'Active' },
  suspended: { tone: 'danger', label: 'Suspended' },
};

export function statusMeta(status: string): StatusMeta {
  return STATUS_META[status?.toLowerCase?.() ?? ''] ?? { tone: 'neutral', label: status || 'Unknown' };
}

/** Translated status label (t('status.<key>')), raw text for unknown statuses. */
export function useStatusLabel(): (status: AnyStatus) => string {
  const t = useT();
  return (status) => {
    const key = String(status ?? '').toLowerCase();
    return STATUS_META[key] ? t(`status.${key}`) : status || t('common.unknown');
  };
}

/**
 * Maps a migration / step / connection status to a Badge with a dot.
 * `running` and `testing` pulse. Unknown strings fall back to a neutral badge with the raw text.
 */
export function StatusBadge({ status, label, ...rest }: StatusBadgeProps) {
  const meta = statusMeta(status);
  const statusLabel = useStatusLabel();
  return (
    <Badge tone={meta.tone} dot pulse={meta.pulse} {...rest}>
      {label ?? statusLabel(status)}
    </Badge>
  );
}

export default StatusBadge;
