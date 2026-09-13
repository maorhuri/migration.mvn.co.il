import { forwardRef, type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { ChevronDownIcon, ChevronUpIcon, ChevronUpDownIcon } from '@heroicons/react/16/solid';
import { cn } from '../../lib/cn';

export type SortDirection = 'asc' | 'desc';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Dense rows (13px text, py-2). Default true — this is an ops tool. */
  dense?: boolean;
  /** Keep the header visible while the container scrolls. */
  stickyHeader?: boolean;
  /** Wrapper className (the wrapper owns the border, radius and overflow). */
  wrapperClassName?: string;
  /** Render the wrapper without its own border — when the table is inside a `flush` Card. */
  bare?: boolean;
  /** Max height for the scroll container, e.g. "60vh". */
  maxHeight?: string;
}

/**
 * Table wrapper with rounded border and horizontal overflow. Inside a `<Card flush>` set `bare`.
 * Compose: Table > THead > TR > TH, TBody > TR > TD.
 */
export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  { dense = true, stickyHeader, wrapperClassName, bare, maxHeight, className, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        'relative w-full overflow-auto',
        !bare && 'rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
        wrapperClassName,
      )}
      style={maxHeight ? { maxHeight } : undefined}
      data-sticky={stickyHeader || undefined}
    >
      <table
        ref={ref}
        className={cn(
          'w-full min-w-full border-collapse text-left',
          dense ? 'text-[13px]' : 'text-sm',
          stickyHeader && '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10',
          className,
        )}
        {...rest}
      />
    </div>
  );
});

export const THead = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(function THead({ className, ...rest }, ref) {
  return <thead ref={ref} className={cn('bg-slate-50 dark:bg-slate-800/60', className)} {...rest} />;
});

export const TBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(function TBody({ className, ...rest }, ref) {
  return <tbody ref={ref} className={cn('divide-y divide-slate-100 dark:divide-slate-800', className)} {...rest} />;
});

export interface TRProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Highlight on hover (default true in body rows). */
  hoverable?: boolean;
  /** Selected/active styling. */
  selected?: boolean;
  /** Clickable row: pointer + role/tabindex (pass `onClick`). */
  clickable?: boolean;
}

export const TR = forwardRef<HTMLTableRowElement, TRProps>(function TR({ hoverable = true, selected, clickable, className, ...rest }, ref) {
  return (
    <tr
      ref={ref}
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? 'button' : undefined}
      onKeyDown={
        clickable && rest.onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                (rest.onClick as (ev: unknown) => void)(e);
              }
              rest.onKeyDown?.(e);
            }
          : rest.onKeyDown
      }
      className={cn(
        'transition-colors',
        hoverable && 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
        selected && 'bg-indigo-50/60 hover:bg-indigo-50 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/15',
        clickable && 'cursor-pointer focus-visible:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/50',
        className,
      )}
      {...rest}
    />
  );
});

export interface THProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Make the header a sort button. */
  sortable?: boolean;
  /** Current sort direction if this column is sorted. */
  sorted?: SortDirection | false | null;
  onSort?: () => void;
  align?: 'left' | 'center' | 'right';
  /** Numeric column: right-aligned, tabular figures. */
  numeric?: boolean;
}

export const TH = forwardRef<HTMLTableCellElement, THProps>(function TH(
  { sortable, sorted, onSort, align, numeric, className, children, ...rest },
  ref,
) {
  const alignment = numeric ? 'right' : align ?? 'left';
  const alignClass = alignment === 'right' ? 'text-right' : alignment === 'center' ? 'text-center' : 'text-left';
  const SortIcon = sorted === 'asc' ? ChevronUpIcon : sorted === 'desc' ? ChevronDownIcon : ChevronUpDownIcon;
  return (
    <th
      ref={ref}
      scope="col"
      aria-sort={sortable ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined}
      className={cn(
        'whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400',
        numeric && 'tabular',
        alignClass,
        className,
      )}
      {...rest}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'group/th -mx-1 inline-flex items-center gap-1 rounded px-1 uppercase tracking-wide transition-colors hover:text-slate-900 dark:hover:text-slate-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
            sorted && 'text-slate-900 dark:text-slate-100',
            alignment === 'right' && 'flex-row-reverse',
          )}
        >
          {children}
          <SortIcon className={cn('h-3.5 w-3.5 shrink-0', sorted ? 'text-indigo-500' : 'text-slate-400 opacity-0 group-hover/th:opacity-100')} aria-hidden="true" />
        </button>
      ) : (
        children
      )}
    </th>
  );
});

export interface TDProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** Monospace: IPs, hosts, ids, paths. */
  mono?: boolean;
  align?: 'left' | 'center' | 'right';
  numeric?: boolean;
  /** Muted secondary text. */
  muted?: boolean;
  /** Truncate long text (set a max-width via className). */
  truncate?: boolean;
}

export const TD = forwardRef<HTMLTableCellElement, TDProps>(function TD(
  { mono, align, numeric, muted, truncate, className, ...rest },
  ref,
) {
  const alignment = numeric ? 'right' : align ?? 'left';
  return (
    <td
      ref={ref}
      className={cn(
        'px-4 py-2.5 align-middle text-slate-700 dark:text-slate-300',
        mono && 'font-mono text-xs',
        numeric && 'tabular',
        muted && 'text-slate-500 dark:text-slate-400',
        truncate && 'max-w-0 truncate',
        alignment === 'right' ? 'text-right' : alignment === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      {...rest}
    />
  );
});

/** Primary-text cell: darker, medium weight (domain, name). */
export const TDPrimary = forwardRef<HTMLTableCellElement, TDProps>(function TDPrimary({ className, ...rest }, ref) {
  return <TD ref={ref} className={cn('font-medium text-slate-900 dark:text-slate-100', className)} {...rest} />;
});

export default Table;
