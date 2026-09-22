import { cn } from '../../lib/cn';
import { badgeToneClasses } from './Badge';
import { panelTone, usePanelLabel } from './PanelBadge';

export interface PanelMonogramProps {
  panelType: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const LETTERS: Record<string, string> = {
  directadmin: 'DA',
  enhance: 'EN',
  cpanel: 'cP',
  cloudpanel: 'CP',
  cloudways: 'CW',
  ftp: 'FTP',
  wordpress: 'WP',
};

const sizeClasses = {
  sm: 'h-6 w-6 rounded-md text-[10px]',
  md: 'h-8 w-8 rounded-lg text-[11px]',
  lg: 'h-10 w-10 rounded-lg text-xs',
};

/** Square tile with the panel's monogram (DA / EN / cP / CP / FTP / WP / SR) in the panel tone. */
export function PanelMonogram({ panelType, size = 'md', className }: PanelMonogramProps) {
  const label = usePanelLabel();
  return (
    <span
      role="img"
      aria-label={label(panelType)}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-semibold ring-1 ring-inset',
        sizeClasses[size],
        badgeToneClasses[panelTone(panelType)],
        className,
      )}
    >
      <span dir="ltr">{LETTERS[panelType ?? ''] ?? 'SR'}</span>
    </span>
  );
}

export default PanelMonogram;
