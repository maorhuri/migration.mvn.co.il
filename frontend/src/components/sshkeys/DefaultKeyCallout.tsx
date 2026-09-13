import { ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/20/solid';
import { cn } from '../../lib/cn';
import type { SSHKey } from '../../types';

export interface DefaultKeyCalloutProps {
  /** The key currently flagged as default, or `null` when none is set. */
  defaultKey: SSHKey | null;
  /** Open the key details (install command) for the default key. */
  onView?: (key: SSHKey) => void;
  className?: string;
}

/**
 * Explains which key the tool uses for Enhance cluster nodes. Renders as an info note when a
 * default is set and as a warning when none is, since cluster migrations depend on it.
 */
export function DefaultKeyCallout({ defaultKey, onView, className }: DefaultKeyCalloutProps) {
  const warn = defaultKey === null;
  const Icon = warn ? ExclamationTriangleIcon : InformationCircleIcon;

  return (
    <div
      role={warn ? 'alert' : 'note'}
      className={cn(
        'flex gap-3 rounded-xl border px-4 py-3 text-sm',
        warn
          ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
          : 'border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10',
        className,
      )}
    >
      <Icon
        className={cn('mt-0.5 h-5 w-5 shrink-0', warn ? 'text-amber-500 dark:text-amber-400' : 'text-sky-500 dark:text-sky-400')}
        aria-hidden="true"
      />
      <div className="min-w-0">
        {warn ? (
          <>
            <p className="font-medium text-amber-900 dark:text-amber-100">No default key for Enhance cluster nodes</p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-200/90">
              Migrations that SSH into cluster nodes need a default key. Mark one with the star in the table, then install it on every node.
            </p>
          </>
        ) : (
          <>
            <p className="font-medium text-sky-900 dark:text-sky-100">
              Default key for Enhance cluster nodes:{' '}
              {onView ? (
                <button
                  type="button"
                  onClick={() => onView(defaultKey)}
                  className="rounded font-mono underline decoration-sky-300 underline-offset-2 transition-colors hover:decoration-sky-500 dark:decoration-sky-500/50 dark:hover:decoration-sky-300"
                >
                  {defaultKey.name}
                </button>
              ) : (
                <span className="font-mono">{defaultKey.name}</span>
              )}
            </p>
            <p className="mt-0.5 text-sky-800 dark:text-sky-200/90">
              The tool uses this key to SSH into cluster nodes. Install its public key on each node once — open the key for the install command.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default DefaultKeyCallout;
