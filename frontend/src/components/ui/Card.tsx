import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Remove the default inner padding — use when the card holds a Table. */
  flush?: boolean;
  /** Elevate slightly on hover and show a pointer (for clickable cards). */
  interactive?: boolean;
  /** Left accent strip tone. */
  accent?: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'blue' | 'orange';
}

const accentClasses = {
  brand: 'border-l-4 border-l-indigo-500',
  success: 'border-l-4 border-l-emerald-500',
  warning: 'border-l-4 border-l-amber-500',
  danger: 'border-l-4 border-l-rose-500',
  info: 'border-l-4 border-l-sky-500',
  violet: 'border-l-4 border-l-violet-500',
  blue: 'border-l-4 border-l-blue-500',
  orange: 'border-l-4 border-l-orange-500',
};

/**
 * Surface container: white/slate-900, 1px border, soft shadow, 12px radius.
 * Compose with CardHeader / CardContent / CardFooter. Tables go in a `flush` card.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { flush, interactive, accent, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
        !flush && 'p-5 sm:p-6',
        interactive &&
          'cursor-pointer transition-all duration-150 hover:border-slate-300 hover:shadow-pop dark:hover:border-slate-700 ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
        accent && accentClasses[accent],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** Right-aligned actions slot. */
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
        divided ? 'border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6' : 'mb-4',
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
  return <div ref={ref} className={cn(padded && 'px-5 py-4 sm:px-6', className)} {...rest} />;
});

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { divided?: boolean }>(
  function CardFooter({ divided = true, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-wrap items-center justify-end gap-2',
          divided ? 'mt-5 border-t border-slate-200 pt-4 dark:border-slate-800' : 'mt-4',
          className,
        )}
        {...rest}
      />
    );
  },
);

export default Card;
