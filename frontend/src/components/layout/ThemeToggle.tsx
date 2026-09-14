import { ComputerDesktopIcon, MoonIcon, SunIcon } from '@heroicons/react/20/solid';
import { useTheme, type Theme } from '../../lib/theme';
import { useT } from '../../lib/i18n';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';

const NEXT: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };

/** Cycles light -> dark -> system. Shows the icon of the current preference. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'dark' ? MoonIcon : theme === 'light' ? SunIcon : ComputerDesktopIcon;
  const current = t(`theme.${theme}`);
  const next = t(`theme.${NEXT[theme]}`);
  return (
    <Tooltip content={t('theme.current', { name: current })} side="bottom" align="end" className={className}>
      <IconButton
        aria-label={`${t('theme.current', { name: current })}. ${t('theme.switchTo', { name: next })}`}
        icon={<Icon />}
        size="sm"
        onClick={() => setTheme(NEXT[theme])}
      />
    </Tooltip>
  );
}

export default ThemeToggle;
