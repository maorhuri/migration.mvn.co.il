import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { badgeDotClasses, type BadgeTone } from './Badge';

/** The one surface recipe: white card, hairline border, 14px radius, no shadow at rest. */
export const surfaceClasses = 'rounded-xl border border-slate-200 bg-white dark:border-white/[0.08] dark:bg-slate-900';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Remove the default inner padding — use when the card holds a Table. */
  flush?: boolean;
  /** Lift slightly on hover and show a pointer (for clickable cards). */
  interactive?: boolean;
  /** Start-side accent strip tone. */
  accent?: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'blue' | 'orange';
  /** 2px colored top edge (state at a glance, quieter than `accent`). */
  edge?: BadgeTone;
}

const accentClasses = {
  brand: 'border-s-4 border-s-brand-500',
  success: 'border-s-4 border-s-emerald-500',
  warning: 'border-s-4 border-s-amber-500',
  danger: 'border-s-4 border-s-rose-500',
  info: 'border-s-4 border-s-sky-500',
  violet: 'border-s-4 border-s-violet-500',
  blue: 'border-s-4 border-s-blue-500',
  orange: 'border-s-4 border-s-orange-500',
};

/**
 * Surface container: white/slate-900, hairline border, 14px radius, 24px padding, no shadow.
 * Compose with CardHeader / CardContent / CardFooter. Tables go in a `flush` card.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { flush, interactive, accent, edge, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        surfaceClasses,
        !flush && 'p-6',
        interactive &&
          'cursor-pointer transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-px hover:border-slate-300 hover:shadow-pop dark:hover:border-white/[0.16] dark:hover:shadow-pop-dark motion-reduce:hover:translate-y-0 ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-brand-300 dark:focus-visible:ring-offset-slate-900',
        accent && accentClasses[accent],
        edge && 'relative overflow-hidden',
        className,
      )}
      {...rest}
    >
      {edge && <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-xl', badgeDotClasses[edge])} />}
      {children}
    </div>
  );
});

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** End-aligned actions slot. */
  actions?: ReactNode;
  /** Draw a bottom border (recommended when the card is `flush`). */
  divided?: boolean;
}

/** Title row for a card. Put `<CardTitle>` + `<CardDescription>` as children and buttons in `actions`. */
export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { actions, divided, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-wrap items-start justify-between gap-3',
        divided ? 'border-b border-slate-200 px-6 py-4 dark:border-white/[0.08]' : 'mb-4',
        className,
      )}
      {...rest}
    >
      <div className="min-w-0 flex-1 space-y-0.5">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
});

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement> & { as?: 'h2' | 'h3' | 'h4' }>(
  function CardTitle({ as: Tag = 'h2', className, ...rest }, ref) {
    return <Tag ref={ref} className={cn('text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100', className)} {...rest} />;
  },
);

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...rest }, ref) {
    return <p ref={ref} className={cn('text-sm text-slate-500 dark:text-slate-400', className)} {...rest} />;
  },
);

export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  /** Add padding — only needed inside a `flush` card. */
  padded?: boolean;
}

export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(function CardContent({ padded, className, ...rest }, ref) {
  return <div ref={ref} className={cn(padded && 'px-6 py-4', className)} {...rest} />;
});

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { divided?: boolean }>(
  function CardFooter({ divided = true, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-wrap items-center justify-end gap-2',
          divided ? 'mt-5 border-t border-slate-200 pt-4 dark:border-white/[0.08]' : 'mt-4',
          className,
        )}
        {...rest}
      />
    );
  },
);

export default Card;
