/**
 * Tiny className joiner. Accepts strings, falsy values, arrays and
 * `{ className: boolean }` objects. No dependency on clsx/tailwind-merge:
 * order matters, so pass overriding classes last and avoid conflicting utilities.
 *
 * @example cn('px-2', isActive && 'bg-brand-50', { 'opacity-50': disabled })
 */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input));
    } else if (Array.isArray(input)) {
      const inner = cn(...input);
      if (inner) out.push(inner);
    } else if (typeof input === 'object') {
      for (const key of Object.keys(input)) {
        if (input[key]) out.push(key);
      }
    }
  }
  return out.join(' ');
}

export default cn;
