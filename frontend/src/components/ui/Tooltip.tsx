import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type TooltipSide = 'top' | 'bottom' | 'start' | 'end' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** `start`/`end` follow the writing direction; `left`/`right` are accepted and mapped to them. */
  side?: TooltipSide;
  /** For `top`/`bottom`: anchor the bubble to the trigger's start or end edge instead of centering it (use near viewport edges). */
  align?: 'center' | 'start' | 'end';
  /** Wrapper className (the wrapper is `inline-flex`). */
  className?: string;
}

const sideClasses: Record<'top' | 'bottom' | 'start' | 'end', string> = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
  start: 'end-full top-1/2 me-2 -translate-y-1/2',
  end: 'start-full top-1/2 ms-2 -translate-y-1/2',
};

const alignClasses = {
  center: 'start-1/2 -translate-x-1/2 rtl:translate-x-1/2',
  start: 'start-0',
  end: 'end-0',
};

function normalize(side: TooltipSide): 'top' | 'bottom' | 'start' | 'end' {
  if (side === 'left') return 'start';
  if (side === 'right') return 'end';
  return side;
}

/**
 * Lightweight CSS tooltip (hover + focus-within). Keep content short.
 * For icon buttons still pass `aria-label`; the tooltip is visual only.
 */
export function Tooltip({ content, children, side = 'top', align = 'center', className }: TooltipProps) {
  const s = normalize(side);
  return (
    <span className={cn('group/tip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-40 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-pop',
          // display:none at rest so a hidden bubble never widens the page; fades in via animation.
          'hidden motion-safe:animate-fade-in group-hover/tip:block group-focus-within/tip:block',
          'dark:bg-slate-100 dark:text-slate-900',
          sideClasses[s],
          (s === 'top' || s === 'bottom') && alignClasses[align],
        )}
      >
        {content}
      </span>
    </span>
  );
}

export default Tooltip;
