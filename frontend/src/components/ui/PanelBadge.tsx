import { Badge, type BadgeProps, type BadgeTone } from './Badge';
import { panelLabel } from '../../lib/format';

export interface PanelBadgeProps extends Omit<BadgeProps, 'tone' | 'children'> {
  panelType: string | null | undefined;
  /** Show the label text (default) or just a colored dot for dense tables. */
  compact?: boolean;
}

export const PANEL_TONES: Record<string, BadgeTone> = {
  enhance: 'violet',
  directadmin: 'blue',
  cpanel: 'orange',
  cloudpanel: 'info',
  ftp: 'neutral',
  wordpress: 'brand',
};

export function panelTone(panelType: string | null | undefined): BadgeTone {
  return PANEL_TONES[panelType ?? ''] ?? 'neutral';
}

/**
 * Panel identity badge: Enhance = violet, DirectAdmin = blue, cPanel = orange,
 * CloudPanel = sky, FTP = neutral, WordPress = indigo.
 */
export function PanelBadge({ panelType, compact, ...rest }: PanelBadgeProps) {
  return (
    <Badge tone={panelTone(panelType)} dot={compact} {...rest}>
      {compact ? null : panelLabel(panelType)}
    </Badge>
  );
}

export default PanelBadge;
