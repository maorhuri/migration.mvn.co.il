import type { CSSProperties } from 'react';
import { ArrowDownRightIcon, ExclamationTriangleIcon } from '@heroicons/react/16/solid';
import { Badge, Card, CardDescription, CardHeader, CardTitle, Mono } from '../ui';
import { formatTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { MigrationLog } from '../../types';

export interface WarningsCardProps {
  warnings: MigrationLog[];
  /** Scroll the console to this warning's line. */
  onJump: (logId: string) => void;
  className?: string;
  style?: CSSProperties;
}

/** Every warn-level log line as a row that jumps to the console. Renders nothing when there are none. */
export function WarningsCard({ warnings, onJump, className, style }: WarningsCardProps) {
  const t = useT();
  if (warnings.length === 0) return null;
  return (
    <Card edge="warning" flush className={className} style={style}>
      <CardHeader
        divided
        actions={
          <Badge tone="warning" icon={<ExclamationTriangleIcon />} className="tabular">
            {t('units.warnings', { count: warnings.length })}
          </Badge>
        }
      >
        <CardTitle>{t('migrationdetail.warnings.title')}</CardTitle>
        <CardDescription>{t('migrationdetail.warnings.description')}</CardDescription>
      </CardHeader>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto py-1 dark:divide-white/[0.06]">
        {warnings.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => onJump(w.id)}
              title={t('migrationdetail.warnings.jump')}
              aria-label={`${t('migrationdetail.warnings.jump')}: ${w.message}`}
              className="group flex w-full items-start gap-3 px-6 py-2.5 text-start text-sm transition-colors hover:bg-amber-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:hover:bg-amber-500/10 dark:focus-visible:ring-brand-300"
            >
              <Mono className="mt-0.5 shrink-0 text-xs tabular text-slate-400 dark:text-slate-500">{formatTime(w.created_at)}</Mono>
              <span dir="ltr" className="ltr min-w-0 flex-1 whitespace-pre-wrap break-words text-amber-800 dark:text-amber-200">
                {w.message}
              </span>
              <ArrowDownRightIcon
                className="flip-rtl mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-amber-600 dark:text-slate-600 dark:group-hover:text-amber-400"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default WarningsCard;
