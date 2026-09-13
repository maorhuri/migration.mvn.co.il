import { Fragment, type ReactNode } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/20/solid';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: ModalSize;
  /** Footer slot — usually `<Button>`s, right-aligned. */
  footer?: ReactNode;
  /** Hide the top-right close button. */
  hideClose?: boolean;
  /** Remove body padding (e.g. when the body is a list). */
  flush?: boolean;
  /** Element to focus initially. */
  initialFocus?: React.MutableRefObject<HTMLElement | null>;
  children?: ReactNode;
  className?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * Dialog with backdrop, fade/scale transition, header, scrolling body and footer.
 * Forms: put the `<form>` around Modal children and footer buttons of `type="submit"` inside `footer`
 * by giving the form an `id` and the button `form="that-id"`.
 */
export function Modal({ open, onClose, title, description, size = 'md', footer, hideClose, flush, initialFocus, children, className }: ModalProps) {
  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose} initialFocus={initialFocus}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-150"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] dark:bg-slate-950/70" aria-hidden="true" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-150"
              enterFrom="opacity-0 scale-[0.97] translate-y-1"
              enterTo="opacity-100 scale-100 translate-y-0"
              leave="ease-in duration-100"
              leaveFrom="opacity-100 scale-100 translate-y-0"
              leaveTo="opacity-0 scale-[0.97] translate-y-1"
            >
              <Dialog.Panel
                className={cn(
                  'flex w-full transform flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left align-middle shadow-2xl shadow-slate-900/10 transition-all dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40',
                  'max-h-[calc(100vh-2rem)]',
                  sizeClasses[size],
                  className,
                )}
              >
                {(title || !hideClose) && (
                  <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
                    <div className="min-w-0">
                      {title && (
                        <Dialog.Title as="h2" className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                          {title}
                        </Dialog.Title>
                      )}
                      {description && (
                        <Dialog.Description className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</Dialog.Description>
                      )}
                    </div>
                    {!hideClose && <IconButton aria-label="Close" icon={<XMarkIcon />} size="sm" onClick={onClose} className="-mr-1.5 -mt-1" />}
                  </div>
                )}

                <div className={cn('min-h-0 flex-1 overflow-y-auto', !flush && 'px-5 py-5 sm:px-6')}>{children}</div>

                {footer && (
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-800/40 sm:px-6">
                    {footer}
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

export default Modal;
