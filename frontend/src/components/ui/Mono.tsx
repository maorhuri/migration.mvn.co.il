import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface MonoProps {
  children: ReactNode;
  className?: string;
  /** `span` (default, renders a `<bdi>`) or `code`. */
  as?: 'span' | 'code';
  /** Render as a block (own line) instead of inline-block. */
  block?: boolean;
}

/**
 * Left-to-right monospace value: domains, hosts, IPs, ids, paths, usernames, commands.
 * EVERY technical value in Hebrew mode goes through Mono, CodeBlock or a `TD mono`.
 */
export function Mono({ children, className, as = 'span', block }: MonoProps) {
  const Tag = as === 'code' ? 'code' : 'bdi';
  return (
    <Tag dir="ltr" className={cn('font-mono ltr max-w-full truncate align-bottom', block ? 'block' : 'inline-block', className)}>
      {children}
    </Tag>
  );
}

export default Mono;
