import { Mono } from '../ui';
import { cn } from '../../lib/cn';

const PREFIX = /^(SHA256|MD5):/i;

/** Deterministic hue (0..359) from the hash part of a fingerprint, so each key gets its own colour. */
export function fingerprintHue(fingerprint: string): number {
  const hash = fingerprint.replace(PREFIX, '');
  const c = (i: number) => hash.charCodeAt(i) || 0;
  return (c(0) * 31 + c(1) * 17 + c(2)) % 360;
}

/** Split "SHA256:abcd..." into its algorithm prefix and the hash grouped in 4-char runs. */
export function splitFingerprint(fingerprint: string): { prefix: string; grouped: string } {
  const m = fingerprint.match(PREFIX);
  const prefix = m ? m[0] : '';
  const hash = fingerprint.slice(prefix.length);
  // Colon-separated (MD5 hex) fingerprints are already grouped; only base64 hashes get 4-char runs.
  const grouped = hash.includes(':') ? hash : hash.match(/.{1,4}/g)?.join(' ') ?? hash;
  return { prefix, grouped };
}

export interface FingerprintChipProps {
  fingerprint: string;
  /** `always` shows the algorithm prefix everywhere; `wide` hides it under 1400px (dense table columns). */
  prefix?: 'always' | 'wide';
  className?: string;
}

/**
 * Identity chip for a key: an 8px dot whose hue is derived from the hash, the muted algorithm
 * prefix and the hash grouped in 4-char runs. Always LTR; `title` carries the full fingerprint.
 */
export function FingerprintChip({ fingerprint, prefix: prefixMode = 'always', className }: FingerprintChipProps) {
  const hue = fingerprintHue(fingerprint);
  const { prefix, grouped } = splitFingerprint(fingerprint);
  const color = `hsl(${hue} 70% 55%)`;
  return (
    <span dir="ltr" title={fingerprint} className={cn('ltr inline-flex min-w-0 max-w-full items-center gap-2 text-xs', className)}>
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 0 3px hsl(${hue} 70% 55% / 0.18)` }}
      />
      {prefix && (
        <Mono className={cn('shrink-0 text-slate-400 dark:text-slate-500', prefixMode === 'wide' ? 'hidden min-[1400px]:inline-block' : 'inline-block')}>
          {prefix}
        </Mono>
      )}
      <Mono className="min-w-0 tracking-tight text-slate-700 [word-spacing:0.2em] dark:text-slate-300">{grouped}</Mono>
    </span>
  );
}

export default FingerprintChip;
