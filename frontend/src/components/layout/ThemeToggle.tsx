import { ComputerDesktopIcon, MoonIcon, SunIcon } from '@heroicons/react/20/solid';
import { useTheme, type Theme } from '../../lib/theme';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';

const NEXT: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
const LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };

/** Cycles light -> dark -> system. Shows the icon of the current preference. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'dark' ? MoonIcon : theme === 'light' ? SunIcon : ComputerDesktopIcon;
  return (
    <Tooltip content={`Theme: ${LABEL[theme]}`} side="bottom" className={className}>
      <IconButton
        aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[NEXT[theme]]}`}
        icon={<Icon />}
        size="sm"
        onClick={() => setTheme(NEXT[theme])}
      />
    </Tooltip>
  );
}

export default ThemeToggle;
