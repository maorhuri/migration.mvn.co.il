import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** Keyboard key cap, e.g. `<Kbd>⌘</Kbd><Kbd>K</Kbd>`. */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      dir="ltr"
      className={cn(
        'inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-slate-200 bg-slate-50 px-1 font-sans text-[11px] font-medium text-slate-500 shadow-[inset_0_-1px_0_0_theme(colors.slate.200)]',
        'dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-slate-400 dark:shadow-[inset_0_-1px_0_0_rgb(255_255_255_/_0.08)]',
        className,
      )}
      {...rest}
    />
  );
}

export default Kbd;
