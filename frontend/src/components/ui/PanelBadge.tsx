import { Badge, type BadgeProps, type BadgeTone } from './Badge';
import { useT } from '../../lib/i18n';

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
  cloudways: 'success',
  ftp: 'lime',
  wordpress: 'cyan',
};

export const PANEL_TYPES = ['directadmin', 'enhance', 'cpanel', 'cloudpanel', 'cloudways', 'ftp', 'wordpress'] as const;
/** Control panels reached over SSH (the "Server" kind of the add-target form). */
export const SERVER_PANEL_TYPES = ['directadmin', 'enhance', 'cpanel', 'cloudways'] as const;

export function panelTone(panelType: string | null | undefined): BadgeTone {
  return PANEL_TONES[panelType ?? ''] ?? 'neutral';
}

/** Translated panel label: t('panel.<type>'), raw string for unknown types, t('panel.unknown') when empty. */
export function usePanelLabel(): (panelType: string | null | undefined) => string {
  const t = useT();
  return (panelType) => {
    if (!panelType) return t('panel.unknown');
    return (PANEL_TYPES as readonly string[]).includes(panelType) ? t(`panel.${panelType}`) : panelType;
  };
}

/**
 * Panel identity badge: Enhance = violet, DirectAdmin = blue, cPanel = orange,
 * CloudPanel = sky, FTP = lime, WordPress = cyan.
 */
export function PanelBadge({ panelType, compact, ...rest }: PanelBadgeProps) {
  const label = usePanelLabel();
  return (
    <Badge tone={panelTone(panelType)} dot={compact} {...rest}>
      {compact ? null : label(panelType)}
    </Badge>
  );
}

export default PanelBadge;
