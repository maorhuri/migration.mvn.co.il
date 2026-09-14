import type { CSSProperties } from 'react';
import { cn } from '../../lib/cn';

export type IllustrationName = 'servers' | 'migrations' | 'keys' | 'accounts' | 'search' | 'log' | 'system' | 'attention' | 'error';

export interface IllustrationProps {
  name: IllustrationName;
  className?: string;
}

const ACCENT = 'text-brand-500 dark:text-brand-400';
/** Failure states use the danger tone, never the brand accent. */
const ALERT = 'text-rose-500 dark:text-rose-400';
/** Mirror a group in place (SVG transforms default to the origin, not the box). */
const inPlace: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };

/**
 * Small line illustrations for empty states (160x96, 1.5px strokes, brand accents).
 * `error` is the one for "could not load" / disconnected states: two nodes, a broken wire and a rose
 * exclamation, no check mark. Decorative: `aria-hidden`.
 */
export function Illustration({ name, className }: IllustrationProps) {
  return (
    <svg
      viewBox="0 0 160 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('h-full w-full text-slate-300 dark:text-slate-600', className)}
    >
      {name === 'migrations' && (
        <>
          <rect x="12" y="28" width="48" height="40" rx="8" />
          <rect x="100" y="28" width="48" height="40" rx="8" />
          <circle cx="24" cy="40" r="1.5" fill="currentColor" stroke="none" />
          <g className={ACCENT}><circle cx="30" cy="40" r="1.5" fill="currentColor" stroke="none" /></g>
          <circle cx="36" cy="40" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="112" cy="40" r="1.5" fill="currentColor" stroke="none" />
          <g className={ACCENT}><circle cx="118" cy="40" r="1.5" fill="currentColor" stroke="none" /></g>
          <circle cx="124" cy="40" r="1.5" fill="currentColor" stroke="none" />
          <path d="M24 52h24M112 52h20" />
          <g className={cn(ACCENT, 'flip-rtl')} style={inPlace}>
            <path d="M60 48C76 48 84 48 100 48" strokeDasharray="4 4" />
            <path d="M94 42l6 6-6 6" />
          </g>
        </>
      )}
      {name === 'servers' && (
        <>
          <rect x="40" y="20" width="80" height="18" rx="5" />
          <rect x="40" y="44" width="80" height="18" rx="5" />
          <rect x="40" y="68" width="80" height="18" rx="5" />
          <g className={ACCENT}><circle cx="52" cy="29" r="2" fill="currentColor" stroke="none" /></g>
          <circle cx="52" cy="53" r="2" fill="currentColor" stroke="none" />
          <circle cx="52" cy="77" r="2" fill="currentColor" stroke="none" />
          <path d="M96 29h14M96 53h14M96 77h14" />
        </>
      )}
      {name === 'keys' && (
        <>
          <circle cx="48" cy="48" r="20" strokeDasharray="3 5" className="opacity-70" />
          <circle cx="48" cy="48" r="14" />
          <circle cx="44" cy="44" r="3" />
          <path d="M62 48h58" />
          <g className={ACCENT}>
            <path d="M104 48v12M114 48v8" />
          </g>
        </>
      )}
      {name === 'accounts' && (
        <>
          <g className={ACCENT}>
            <circle cx="48" cy="28" r="5" />
            <path d="M60 28h40" />
          </g>
          <circle cx="48" cy="48" r="5" />
          <path d="M60 48h40" />
          <circle cx="48" cy="68" r="5" />
          <path d="M60 68h40" />
          <path d="M104 28h8M104 48h8M104 68h8" className="opacity-60" />
        </>
      )}
      {name === 'search' && (
        <>
          <path d="M100 32h48M100 44h40M100 56h48M100 68h32" className="opacity-50" />
          <circle cx="64" cy="44" r="18" />
          <g className={ACCENT}>
            <path d="M77 57l19 19" strokeWidth="2.5" />
          </g>
        </>
      )}
      {name === 'log' && (
        <>
          <rect x="24" y="16" width="112" height="64" rx="8" />
          <path d="M36 32h54M36 44h74M36 56h36" />
          <g className={ACCENT}>
            <rect x="76" y="52" width="4" height="8" rx="1" fill="currentColor" stroke="none" />
          </g>
        </>
      )}
      {name === 'system' && (
        <>
          <rect x="48" y="28" width="64" height="40" rx="8" />
          <rect x="60" y="38" width="40" height="20" rx="3" />
          <path d="M56 20v8M72 20v8M88 20v8M104 20v8M56 68v8M72 68v8M88 68v8M104 68v8M40 36h8M40 48h8M40 60h8M112 36h8M112 48h8M112 60h8" />
          <g className={ACCENT}><circle cx="80" cy="48" r="2" fill="currentColor" stroke="none" /></g>
        </>
      )}
      {name === 'error' && (
        <>
          <rect x="12" y="32" width="44" height="32" rx="7" />
          <rect x="104" y="32" width="44" height="32" rx="7" />
          <circle cx="24" cy="48" r="1.5" fill="currentColor" stroke="none" />
          <path d="M32 48h12" />
          <circle cx="116" cy="48" r="1.5" fill="currentColor" stroke="none" />
          <path d="M124 48h12" />
          <path d="M56 48h9M95 48h9" strokeDasharray="3 3" className="opacity-70" />
          <g className={ALERT}>
            <circle cx="80" cy="48" r="11" />
            <path d="M80 41.5v7.5" strokeWidth="2" />
            <circle cx="80" cy="53.5" r="1.1" fill="currentColor" stroke="none" />
          </g>
        </>
      )}
      {name === 'attention' && (
        <>
          <path d="M80 14l28 10v26c0 16-12 26-28 32-16-6-28-16-28-32V24z" />
          <g className={ACCENT}>
            <path d="M68 48l9 9 17-17" strokeWidth="2.5" className="draw-path motion-safe:animate-draw" />
          </g>
        </>
      )}
    </svg>
  );
}

export default Illustration;
