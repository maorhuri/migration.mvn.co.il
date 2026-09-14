import type { ReactNode } from 'react';
import { CheckIcon, XMarkIcon } from '@heroicons/react/16/solid';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { Spinner } from './Spinner';

export interface Step {
  id: string;
  label: ReactNode;
  description?: ReactNode;
}

export type StepState = 'complete' | 'current' | 'upcoming' | 'error';

export interface StepperProps {
  steps: Step[];
  /** Index of the active step. */
  current: number;
  /** Highest index that is complete (defaults to `current - 1`). */
  completedUpTo?: number;
  /** Index of a step in error state (renders rose). */
  error?: number | null;
  /** Show a spinner on the current step (for running processes). */
  running?: boolean;
  orientation?: 'horizontal' | 'vertical';
  /** Let users jump to completed steps. */
  onStepClick?: (index: number) => void;
  className?: string;
}

export function stepState(index: number, current: number, completedUpTo: number, error?: number | null): StepState {
  if (error === index) return 'error';
  if (index <= completedUpTo) return 'complete';
  if (index === current) return 'current';
  return 'upcoming';
}

/**
 * Wizard / process stepper. Horizontal for the wizard rail, vertical for a running
 * migration's step list (pass `running` so the current step shows a spinner).
 * The connector fills toward the next step as steps complete; the current ring pops in.
 */
export function Stepper({ steps, current, completedUpTo, error, running, orientation = 'horizontal', onStepClick, className }: StepperProps) {
  const t = useT();
  const done = completedUpTo ?? current - 1;
  const vertical = orientation === 'vertical';

  return (
    <ol
      className={cn('flex', vertical ? 'flex-col gap-0' : 'w-full items-start gap-2 overflow-x-auto scrollbar-none', className)}
      aria-label={t('stepper.progress')}
    >
      {steps.map((step, i) => {
        const state = stepState(i, current, done, error);
        const clickable = !!onStepClick && state === 'complete';
        const last = i === steps.length - 1;

        const circle = (
          <span
            className={cn(
              'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
              state === 'complete' && 'border-brand-500/40 bg-brand-50 text-brand-700 dark:border-brand-400/40 dark:bg-brand-500/15 dark:text-brand-300',
              state === 'current' && 'border-transparent bg-brand-700 text-white ring-4 ring-brand-500/15 dark:bg-brand-600 motion-safe:animate-ring-pop',
              state === 'upcoming' && 'border-slate-300 bg-white text-slate-400 dark:border-white/[0.15] dark:bg-slate-900 dark:text-slate-500',
              state === 'error' && 'border-rose-500 bg-rose-500 text-white',
            )}
            aria-hidden="true"
          >
            {state === 'complete' ? (
              <CheckIcon className="h-4 w-4" />
            ) : state === 'error' ? (
              <XMarkIcon className="h-4 w-4" />
            ) : state === 'current' && running ? (
              <Spinner size="sm" />
            ) : (
              i + 1
            )}
          </span>
        );

        const text = (
          <span className={cn('min-w-0', vertical ? 'pb-6 pt-0.5' : 'mt-2')}>
            <span
              className={cn(
                'block text-sm font-medium leading-tight',
                state === 'upcoming' ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-slate-100',
                state === 'error' && 'text-rose-600 dark:text-rose-400',
              )}
            >
              {step.label}
            </span>
            {step.description && (
              <span className={cn('mt-0.5 block text-2xs text-slate-500 dark:text-slate-400', !vertical && 'hidden lg:block')}>{step.description}</span>
            )}
          </span>
        );

        const connector = !last && (
          <span
            aria-hidden="true"
            className={cn(
              vertical
                ? 'absolute start-[13px] top-7 h-[calc(100%-1.75rem)] w-px bg-slate-200 dark:bg-white/[0.08]'
                : 'absolute start-[calc(50%+18px)] end-[calc(-50%+18px)] top-[13px] h-px bg-slate-200 dark:bg-white/[0.08]',
              'after:absolute after:content-[""] after:bg-brand-600 after:transition-transform after:duration-500 dark:after:bg-brand-400',
              vertical
                ? 'after:inset-x-0 after:top-0 after:h-full after:origin-top after:scale-y-0'
                : 'after:inset-y-0 after:start-0 after:w-full after:origin-left after:scale-x-0 rtl:after:origin-right',
              state === 'complete' && (vertical ? 'after:scale-y-100' : 'after:scale-x-100'),
            )}
          />
        );

        const content = vertical ? (
          <div className="relative flex gap-3">
            {connector}
            {circle}
            {text}
          </div>
        ) : (
          <div className="relative flex flex-col items-center text-center">
            {connector}
            {circle}
            {text}
          </div>
        );

        return (
          <li
            key={step.id}
            className={cn(vertical ? 'relative' : 'relative min-w-[7rem] flex-1')}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {clickable ? (
              <button
                type="button"
                onClick={() => onStepClick?.(i)}
                className="w-full rounded-lg text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-brand-300 dark:focus-visible:ring-offset-slate-900"
              >
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default Stepper;
