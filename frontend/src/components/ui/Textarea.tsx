import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { inputBaseClasses, inputBorderClasses } from './Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Monospace (keys, code). */
  mono?: boolean;
}

/** Multi-line input. Use `mono` for SSH keys and code. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, mono, className, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(inputBaseClasses, inputBorderClasses(invalid), 'px-3 py-2 text-sm leading-relaxed', mono && 'font-mono text-xs', className)}
      {...rest}
    />
  );
});

export default Textarea;
