import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';
import { buttonBaseClasses, buttonVariantClasses, type ButtonVariant } from './Button';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required — icon-only buttons must have an accessible name. */
  'aria-label': string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  /** Colors the icon on hover with a semantic tone (e.g. trash -> danger). */
  tone?: 'default' | 'danger' | 'success' | 'brand';
}

const sizeClasses = {
  xs: 'h-6 w-6 rounded-md [&_svg]:h-3.5 [&_svg]:w-3.5',
  sm: 'h-8 w-8 rounded-md [&_svg]:h-4 [&_svg]:w-4',
  md: 'h-9 w-9 rounded-lg [&_svg]:h-[18px] [&_svg]:w-[18px]',
  lg: 'h-10 w-10 rounded-lg [&_svg]:h-5 [&_svg]:w-5',
};

const toneClasses = {
  default: '',
  danger: 'hover:text-rose-600 dark:hover:text-rose-400',
  success: 'hover:text-emerald-600 dark:hover:text-emerald-400',
  brand: 'hover:text-indigo-600 dark:hover:text-indigo-400',
};

/**
 * Square icon-only button. `aria-label` is mandatory; pair with `title` for a native tooltip
 * or wrap in `<Tooltip>`.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = 'ghost', size = 'md', loading, tone = 'default', className, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonBaseClasses, buttonVariantClasses[variant], sizeClasses[size], toneClasses[tone], 'shrink-0', className)}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon}
    </button>
  );
});

export default IconButton;
