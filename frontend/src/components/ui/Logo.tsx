import { useId } from 'react';
import { cn } from '../../lib/cn';

/** The MVN mark: rounded square in the signature gradient with two overlapping arrows. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  const gid = `mvn-logo-${id.replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 64 64" className={cn('h-8 w-8 shrink-0', className)} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#570f3a" />
          <stop offset="0.55" stopColor="#ad1f74" />
          <stop offset="1" stopColor="#e052a7" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gid})`} />
      <path d="M15 25h26M34 18l7 7-7 7" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M49 39H23M30 32l-7 7 7 7" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}

export interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  /** Show the "MVNMigrate" wordmark next to the mark (default true). */
  wordmark?: boolean;
  className?: string;
}

const markSize = { sm: 'h-6 w-6', md: 'h-8 w-8', lg: 'h-10 w-10' };
const wordSize = { sm: 'text-sm', md: 'text-[15px]', lg: 'text-xl' };

/** Mark + wordmark. The wordmark is always LTR ("MVN" in brand, "Migrate" in slate). */
export function Logo({ size = 'md', wordmark = true, className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={markSize[size]} />
      {wordmark && (
        <span dir="ltr" className={cn('font-bold tracking-tight', wordSize[size])}>
          <span className="text-brand-700 dark:text-brand-300">MVN</span>
          <span className="text-slate-900 dark:text-slate-50">Migrate</span>
        </span>
      )}
    </span>
  );
}

export default Logo;
