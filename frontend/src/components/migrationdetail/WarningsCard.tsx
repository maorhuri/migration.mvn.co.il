import { ExclamationTriangleIcon } from '@heroicons/react/20/solid';
import { Badge, Card, CardDescription, CardHeader, CardTitle } from '../ui';
import { formatTime } from '../../lib/format';
import type { MigrationLog } from '../../types';

interface WarningsCardProps {
  warnings: MigrationLog[];
}

/** Amber card listing every warn-level log line, shown above the console when any exist. */
export function WarningsCard({ warnings }: WarningsCardProps) {
  if (warnings.length === 0) return null;
  return (
    <Card accent="warning" flush>
      <CardHeader
        divided
        actions={
          <Badge tone="warning" size="sm" icon={<ExclamationTriangleIcon />}>
            {warnings.length}
          </Badge>
        }
      >
        <CardTitle>Warnings</CardTitle>
        <CardDescription>Items that need a manual check before switching DNS.</CardDescription>
      </CardHeader>
      <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        {warnings.map((w) => (
          <li key={w.id} className="flex gap-3 px-5 py-2.5 text-sm sm:px-6">
            <span className="mt-0.5 shrink-0 font-mono text-xs tabular text-slate-400 dark:text-slate-500">{formatTime(w.created_at)}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words text-amber-800 dark:text-amber-200">{w.message}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default WarningsCard;
