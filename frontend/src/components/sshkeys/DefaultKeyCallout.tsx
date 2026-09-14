import type { CSSProperties } from 'react';
import { ExclamationTriangleIcon, EyeIcon, KeyIcon } from '@heroicons/react/20/solid';
import { Button, Mono, surfaceClasses } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import type { SSHKey } from '../../types';

export interface DefaultKeyCalloutProps {
  /** The key currently flagged as default, or `null` when none is set. */
  defaultKey: SSHKey | null;
  /** Open the key details (install command) for the default key. */
  onView?: (key: SSHKey) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * The default-key story on one calm surface: which key the tool uses for Enhance cluster nodes,
 * with an inline "open key" action. Turns into an amber alert when no default is set, since
 * cluster migrations depend on it.
 */
export function DefaultKeyCallout({ defaultKey, onView, className, style }: DefaultKeyCalloutProps) {
  const t = useT();
  const warn = defaultKey === null;

  if (warn) {
    return (
      <div
        role="alert"
        style={style}
        className={cn(
          'flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-500/30 dark:bg-amber-500/10',
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
        >
          <ExclamationTriangleIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{t('sshkeys.callout.none.title')}</p>
          <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200/90">{t('sshkeys.callout.none.hint')}</p>
        </div>
      </div>
    );
  }

  const open = onView ? () => onView(defaultKey) : undefined;

  return (
    <div
      role="note"
      style={style}
      className={cn(surfaceClasses, 'flex items-start gap-3 border-s-4 border-s-brand-600 px-5 py-4 dark:border-s-brand-400', className)}
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
      >
        <KeyIcon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <span>{t('sshkeys.callout.default.title')}</span>
          {open ? (
            <button
              type="button"
              onClick={open}
              className="rounded text-brand-700 transition-colors hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300 dark:hover:text-brand-200 dark:focus-visible:ring-brand-300"
            >
              <Mono>{defaultKey.name}</Mono>
            </button>
          ) : (
            <Mono className="text-brand-700 dark:text-brand-300">{defaultKey.name}</Mono>
          )}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('sshkeys.callout.default.hint')}</p>
      </div>
      {open && (
        <Button variant="ghost" size="sm" leftIcon={<EyeIcon />} onClick={open} className="-my-1 -me-2 shrink-0 self-center">
          {t('sshkeys.callout.open')}
        </Button>
      )}
    </div>
  );
}

export default DefaultKeyCallout;
