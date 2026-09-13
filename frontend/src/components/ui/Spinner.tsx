import { cn } from '../../lib/cn';

export interface SpinnerProps {
  /** Pixel size shorthand: sm=14, md=18, lg=24, xl=32. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Accessible label; defaults to "Loading". */
  label?: string;
}

const sizes = { sm: 'h-3.5 w-3.5', md: 'h-[18px] w-[18px]', lg: 'h-6 w-6', xl: 'h-8 w-8' };

/**
 * Circular spinner. Inherits `currentColor`, so wrap it in a text color class.
 * Buttons render it automatically when `loading` is set.
 */
export function Spinner({ size = 'md', className, label = 'Loading' }: SpinnerProps) {
  return (
    <svg
      className={cn('animate-spin shrink-0', sizes[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label={label}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V1.5A10.5 10.5 0 0 0 1.5 12H4z" />
    </svg>
  );
}

export default Spinner;
