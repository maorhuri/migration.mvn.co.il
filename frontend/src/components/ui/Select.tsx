import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronUpDownIcon } from '@heroicons/react/20/solid';
import { cn } from '../../lib/cn';
import { inputBaseClasses, inputBorderClasses, inputSizeClasses } from './Input';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  invalid?: boolean;
  size?: 'sm' | 'md';
  /** Either pass `options` or `<option>` children. */
  options?: SelectOption[];
  placeholder?: string;
}

/**
 * Native select styled to match Input. Uses a custom chevron; native dropdown for reliability.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, size = 'md', options, placeholder, className, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(inputBaseClasses, inputBorderClasses(invalid), inputSizeClasses[size], 'appearance-none pr-9', className)}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      <ChevronUpDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden="true" />
    </div>
  );
});

export default Select;
