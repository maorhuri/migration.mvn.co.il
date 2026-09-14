import { cn } from '../../lib/cn';

export type WireStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WireProps {
  status: WireStatus;
  /** `responsive` (default) is vertical under lg and horizontal from lg. */
  orientation?: 'horizontal' | 'vertical' | 'responsive';
  className?: string;
}

const overlayColor: Record<WireStatus, string> = {
  pending: 'text-slate-300 dark:text-slate-600',
  running: 'text-brand-500 dark:text-brand-400',
  completed: 'text-emerald-500',
  failed: 'text-rose-500',
  cancelled: 'text-amber-500',
};

/**
 * The connection between source and target: a wire whose dashes flow while the run is live,
 * a check when it is done, a cross when it failed. Always points source -> target (mirrors in RTL).
 */
export function Wire({ status, orientation = 'responsive', className }: WireProps) {
  const running = status === 'running';
  // Horizontal wires mirror in RTL (source stays on the start side); vertical ones always point down.
  // Tailwind transforms compose (rotate + scale), so no `.flip-rtl` here (it would replace the rotation).
  const transform =
    orientation === 'vertical' ? 'rotate-90' : orientation === 'responsive' ? 'rotate-90 lg:rotate-0 lg:rtl:-scale-x-100' : 'rtl:-scale-x-100';
  return (
    <svg
      viewBox="0 0 96 36"
      className={cn('h-9 w-24 shrink-0', transform, className)}
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M0 18H96" stroke="currentColor" strokeWidth="1.5" className="text-slate-200 dark:text-white/[0.12]" />
      <g className={overlayColor[status]} stroke="currentColor" strokeWidth="1.5">
        <path d="M0 18H96" strokeDasharray={status === 'completed' ? undefined : '6 6'} className={cn(running && 'motion-safe:animate-dash')} />
        <path d="M88 12L96 18L88 24" />
        <circle cx="48" cy="18" r="9" className="fill-white dark:fill-slate-900" />
        {status === 'completed' && <path d="M44 18l3 3 5-6" strokeWidth="2" />}
        {status === 'failed' && <path d="M45 15l6 6M51 15l-6 6" strokeWidth="2" />}
        {status === 'cancelled' && <path d="M44 18h8" strokeWidth="2" />}
        {running && <circle cx="48" cy="18" r="3" fill="currentColor" stroke="none" className="motion-safe:animate-pulse" />}
        {status === 'pending' && <circle cx="48" cy="18" r="2.5" fill="currentColor" stroke="none" />}
      </g>
    </svg>
  );
}

export default Wire;
