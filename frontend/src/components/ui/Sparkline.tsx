import { cn } from '../../lib/cn';

export interface SparklineProps {
  values: number[];
  className?: string;
  height?: number;
}

/**
 * Tiny trend line (polyline + soft area) in `currentColor`. Decorative; renders nothing with
 * fewer than two points. Set the color with a text-* class on it or its parent.
 */
export function Sparkline({ values, className, height = 28 }: SparklineProps) {
  if (values.length < 2) return null;
  const w = 100;
  const h = 100;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - ((v - min) / span) * (h - 8) - 4] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `M0,${h} L${line.replace(/ /g, ' L')} L${w},${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn('block w-20 overflow-visible', className)}
      style={{ height }}
    >
      <path d={area} fill="currentColor" className="opacity-10" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default Sparkline;
