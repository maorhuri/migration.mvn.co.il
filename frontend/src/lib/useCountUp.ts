import { useEffect, useRef, useState } from 'react';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function decimalsOf(n: number): number {
  if (Number.isInteger(n)) return 0;
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(2, s.length - i - 1);
}

/**
 * Animates a number from its previous value to `value` (ease-out cubic, requestAnimationFrame).
 * Returns `value` immediately when the user prefers reduced motion or the value is not finite.
 * First mount counts up from 0.
 */
export function useCountUp(value: number, ms = 600): number {
  const reduced = prefersReducedMotion();
  const finite = Number.isFinite(value);
  const fromRef = useRef(0);
  const [display, setDisplay] = useState(() => (reduced || !finite ? value : 0));

  useEffect(() => {
    if (reduced || !finite) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const decimals = Math.max(decimalsOf(from), decimalsOf(to));
    const factor = 10 ** decimals;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round((from + (to - from) * eased) * factor) / factor;
      setDisplay(v);
      fromRef.current = v;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Background tabs throttle rAF: make sure the final value lands regardless.
    const settle = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      fromRef.current = to;
      setDisplay(to);
    }, ms + 80);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [value, ms, reduced, finite]);

  return reduced || !finite ? value : display;
}

export default useCountUp;
