import type { CSSProperties } from 'react';
import { Card, CardDescription, CardHeader, CardTitle, Mono, Timeline } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import type { TimelineItem } from '../../lib/migrationSteps';

export interface RunTimelineProps {
  items: TimelineItem[];
  /** The run is still going: the running step's duration ticks. */
  live: boolean;
  /** Scroll the console to a step's first log line. */
  onJump: (logId: string) => void;
  /** Source server name for the export phase label. */
  sourceName?: string;
  /** Target node (or server) name for the import phase label. */
  targetName?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Sticky aside card: the run timeline derived from the log, one row per step with its duration.
 * Rows jump to the step's first line in the console.
 */
export function RunTimeline({ items, live, onJump, sourceName, targetName, className, style }: RunTimelineProps) {
  const t = useT();
  const completed = items.filter((item) => item.status === 'completed').length;
  return (
    <Card flush className={cn('lg:sticky lg:top-20', className)} style={style}>
      <CardHeader
        divided
        actions={
          <span dir="ltr" className="text-xs font-medium tabular text-slate-500 dark:text-slate-400">
            {completed} / {items.length}
          </span>
        }
      >
        <CardTitle>{t('migrationdetail.timeline.title')}</CardTitle>
        <CardDescription>{t('migrationdetail.timeline.description')}</CardDescription>
      </CardHeader>
      <div className="lg:max-h-[calc(100vh-11.5rem)] lg:overflow-y-auto">
        <Timeline
          items={items}
          live={live}
          onJump={onJump}
          phaseLabels={{
            // Hostnames stay LTR mono inside the translated phrase.
            export: sourceName ? t.rich('steps.phase.export', { name: <Mono>{sourceName}</Mono> }) : t('steps.phase.export', { name: '' }).trim(),
            scan: t('steps.phase.scan'),
            import: targetName ? t.rich('steps.phase.import', { name: <Mono>{targetName}</Mono> }) : t('steps.phase.import', { name: '' }).trim(),
          }}
        />
      </div>
    </Card>
  );
}

export default RunTimeline;
