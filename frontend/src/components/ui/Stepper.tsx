import type { ReactNode } from 'react';
import { CheckIcon, XMarkIcon } from '@heroicons/react/16/solid';
import { cn } from '../../lib/cn';
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
 */
export function Stepper({ steps, current, completedUpTo, error, running, orientation = 'horizontal', onStepClick, className }: StepperProps) {
  const done = completedUpTo ?? current - 1;
  const vertical = orientation === 'vertical';

  return (
    <ol
      className={cn('flex', vertical ? 'flex-col gap-0' : 'w-full items-start gap-2 overflow-x-auto scrollbar-none', className)}
      aria-label="Progress"
    >
      {steps.map((step, i) => {
        const state = stepState(i, current, done, error);
        const clickable = !!onStepClick && state === 'complete';
        const last = i === steps.length - 1;

        const circle = (
          <span
            className={cn(
              'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
              state === 'complete' && 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500',
              state === 'current' && 'border-indigo-600 bg-white text-indigo-600 ring-4 ring-indigo-500/15 dark:border-indigo-400 dark:bg-slate-900 dark:text-indigo-300',
              state === 'upcoming' && 'border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-500',
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
            {step.description && <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{step.description}</span>}
          </span>
        );

        const connector = !last && (
          <span
            aria-hidden="true"
            className={cn(
              'bg-slate-200 dark:bg-slate-700',
              vertical ? 'absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5' : 'absolute left-[calc(50%+18px)] right-[calc(-50%+18px)] top-[13px] h-0.5',
              i < done + 1 && state === 'complete' && 'bg-indigo-600 dark:bg-indigo-500',
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
                className="w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
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
