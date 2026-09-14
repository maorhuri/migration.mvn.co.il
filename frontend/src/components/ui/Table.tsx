import { forwardRef, type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { ChevronDownIcon, ChevronUpIcon, ChevronUpDownIcon } from '@heroicons/react/16/solid';
import { cn } from '../../lib/cn';
import { surfaceClasses } from './Card';

export { checkboxClasses } from './Checkbox';

export type SortDirection = 'asc' | 'desc';
/** `left`/`right` are kept for compatibility and mean start/end (they mirror in RTL). */
export type CellAlign = 'left' | 'center' | 'right' | 'start' | 'end';

function alignClass(align: CellAlign | undefined, numeric?: boolean): string {
  const a = numeric ? 'end' : align ?? 'start';
  if (a === 'right' || a === 'end') return 'text-end';
  if (a === 'center') return 'text-center';
  return 'text-start';
}

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
      className={cn('relative w-full overflow-auto', !bare && surfaceClasses, wrapperClassName)}
      style={maxHeight ? { maxHeight } : undefined}
      data-sticky={stickyHeader || undefined}
    >
      <table
        ref={ref}
        className={cn(
          'w-full min-w-full border-collapse text-start',
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
  return <thead ref={ref} className={cn('bg-slate-50 dark:bg-white/[0.03]', className)} {...rest} />;
});

export const TBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(function TBody({ className, ...rest }, ref) {
  return <tbody ref={ref} className={cn('divide-y divide-slate-100 dark:divide-white/[0.05]', className)} {...rest} />;
});

export interface TRProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Highlight on hover (default true in body rows). */
  hoverable?: boolean;
  /** Selected/active styling (brand tint + 2px start bar). */
  selected?: boolean;
  /**
   * Clickable row: pointer, tabindex and Enter/Space activation (pass `onClick`).
   * The row keeps its native `row` semantics — no `role="button"` — because rows
   * usually contain their own links and icon buttons, which a button role would hide
   * from assistive technology.
   */
  clickable?: boolean;
}

export const TR = forwardRef<HTMLTableRowElement, TRProps>(function TR({ hoverable = true, selected, clickable, className, ...rest }, ref) {
  return (
    <tr
      ref={ref}
      tabIndex={clickable ? 0 : undefined}
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
        hoverable && 'hover:bg-slate-50 dark:hover:bg-white/[0.03]',
        selected &&
          'bg-brand-50/60 hover:bg-brand-50 dark:bg-brand-500/10 dark:hover:bg-brand-500/15 shadow-[inset_2px_0_0_0_theme(colors.brand.600)] rtl:shadow-[inset_-2px_0_0_0_theme(colors.brand.600)]',
        clickable && 'cursor-pointer focus-visible:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-white/[0.04]',
        className,
      )}
      {...rest}
    />
  );
});

export interface THProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  /** Make the header a sort button. */
  sortable?: boolean;
  /** Current sort direction if this column is sorted. */
  sorted?: SortDirection | false | null;
  onSort?: () => void;
  align?: CellAlign;
  /** Numeric column: end-aligned, tabular figures. */
  numeric?: boolean;
}

export const TH = forwardRef<HTMLTableCellElement, THProps>(function TH(
  { sortable, sorted, onSort, align, numeric, className, children, ...rest },
  ref,
) {
  const cls = alignClass(align, numeric);
  const SortIcon = sorted === 'asc' ? ChevronUpIcon : sorted === 'desc' ? ChevronDownIcon : ChevronUpDownIcon;
  return (
    <th
      ref={ref}
      scope="col"
      aria-sort={sortable ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined}
      className={cn(
        // Hebrew headers keep Latin words as written ("PHP", "Host"), like every other small label in RTL.
        'whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-500 rtl:normal-case rtl:tracking-normal dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400',
        numeric && 'tabular',
        cls,
        className,
      )}
      {...rest}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'group/th -mx-1 inline-flex items-center gap-1 rounded px-1 uppercase tracking-wide transition-colors hover:text-slate-900 rtl:normal-case rtl:tracking-normal dark:hover:text-slate-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:focus-visible:ring-brand-300',
            sorted && 'text-slate-900 dark:text-slate-100',
            cls === 'text-end' && 'flex-row-reverse',
          )}
        >
          {children}
          <SortIcon className={cn('h-3.5 w-3.5 shrink-0', sorted ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400 opacity-0 group-hover/th:opacity-100 dark:text-slate-500')} aria-hidden="true" />
        </button>
      ) : (
        children
      )}
    </th>
  );
});

export interface TDProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> {
  /** Monospace, LTR: IPs, hosts, ids, paths. */
  mono?: boolean;
  align?: CellAlign;
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
  return (
    <td
      ref={ref}
      dir={mono ? 'ltr' : undefined}
      className={cn(
        'px-4 py-2.5 align-middle text-slate-700 dark:text-slate-300',
        mono && 'font-mono text-xs',
        numeric && 'tabular',
        muted && 'text-slate-500 dark:text-slate-400',
        truncate && 'max-w-0 truncate',
        alignClass(align, numeric),
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
