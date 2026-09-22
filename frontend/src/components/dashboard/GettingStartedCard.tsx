import { Link } from 'react-router-dom';
import { CheckIcon, ChevronRightIcon } from '@heroicons/react/16/solid';
import { Badge, Card, CardTitle, CardDescription, Illustration } from '../ui';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import type { Server } from '../../types';

export interface GettingStartedCardProps {
  servers: Server[];
  className?: string;
}

/**
 * Off-state card shown while the fleet has fewer than two servers: a drawn illustration,
 * a title and three benefit bullets that link to where each step happens.
 */
export function GettingStartedCard({ servers, className }: GettingStartedCardProps) {
  const t = useT();
  const hasSource = servers.some((s) => s.panel_type !== 'enhance');
  const hasTarget = servers.some((s) => s.panel_type === 'enhance');

  const steps = [
    { key: 'source', label: t('dashboard.start.source'), to: '/servers', done: hasSource },
    { key: 'target', label: t('dashboard.start.target'), to: '/servers', done: hasTarget },
    { key: 'key', label: t('dashboard.start.key'), to: '/ssh-keys', done: false },
  ];

  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="relative mx-auto mb-4 h-24 w-40">
        <div aria-hidden="true" className="dot-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(closest-side,black,transparent)]" />
        <Illustration name="servers" className="relative" />
      </div>
      <CardTitle className="text-center">{t('dashboard.start.title')}</CardTitle>
      <CardDescription className="mt-1 text-center text-balance">{t('dashboard.start.description')}</CardDescription>

      <ul className="mt-5 space-y-1">
        {steps.map((step, i) => (
          <li key={step.key}>
            <Link
              to={step.to}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors',
                'hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-white/[0.03] dark:focus-visible:bg-white/[0.04]',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular ring-1 ring-inset',
                  step.done
                    ? 'bg-brand-700 text-white ring-brand-700 dark:bg-brand-600 dark:ring-brand-600'
                    : 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30',
                )}
                aria-hidden="true"
              >
                {step.done ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn('min-w-0 flex-1', step.done ? 'text-slate-500 line-through dark:text-slate-400' : 'text-slate-700 dark:text-slate-300')}>
                {step.label}
              </span>
              {step.done ? (
                <Badge tone="success" size="sm">
                  {t('dashboard.start.done')}
                </Badge>
              ) : (
                <ChevronRightIcon
                  className="flip-rtl h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-brand-700 dark:text-slate-600 dark:group-hover:text-brand-300"
                  aria-hidden="true"
                />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default GettingStartedCard;
