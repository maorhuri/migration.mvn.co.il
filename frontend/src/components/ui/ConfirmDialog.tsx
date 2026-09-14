import { Fragment, useRef, useState, type ReactNode } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { Button } from './Button';
import { Input } from './Input';
import { surfaceClasses } from './Card';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called on confirm. May return a promise; the dialog shows loading until it settles. */
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  message?: ReactNode;
  /** Defaults to t('confirm.confirm'). */
  confirmLabel?: string;
  /** Defaults to t('confirm.cancel'). */
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'brand';
  /** External loading control (otherwise inferred from the onConfirm promise). */
  loading?: boolean;
  /** Require the user to type this exact string before confirming (e.g. the server name). */
  confirmText?: string;
  children?: ReactNode;
}

const toneIcon = {
  danger: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
};

/**
 * Confirmation for destructive or irreversible actions. Every delete/cancel goes through this.
 * Use `confirmText` for high-impact deletes (server, migration) to require typing the name.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  loading: loadingProp,
  confirmText,
  children,
}: ConfirmDialogProps) {
  const t = useT();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [internalLoading, setInternalLoading] = useState(false);
  const [typed, setTyped] = useState('');
  const loading = loadingProp ?? internalLoading;
  const canConfirm = !confirmText || typed === confirmText;
  const Icon = tone === 'brand' ? InformationCircleIcon : ExclamationTriangleIcon;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    try {
      setInternalLoading(true);
      await onConfirm();
    } finally {
      setInternalLoading(false);
      setTyped('');
    }
  };

  const handleClose = () => {
    if (loading) return;
    setTyped('');
    onClose();
  };

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose} initialFocus={cancelRef}>
        <Transition.Child as={Fragment} enter="ease-out duration-150" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
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
              <Dialog.Panel className={cn(surfaceClasses, 'w-full max-w-md transform overflow-hidden p-6 text-start shadow-2xl shadow-slate-900/10 transition-all dark:shadow-black/50')}>
                <div className="flex gap-4">
                  <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', toneIcon[tone])}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Dialog.Title as="h2" className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                      {title}
                    </Dialog.Title>
                    {message && <Dialog.Description className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{message}</Dialog.Description>}
                    {children && <div className="mt-3 text-sm">{children}</div>}
                    {confirmText && (
                      <div className="mt-4 space-y-2">
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {t.rich('confirm.typeToConfirm', {
                            text: (
                              <bdi dir="ltr" className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs font-medium text-slate-900 dark:bg-white/[0.08] dark:text-slate-100">
                                {confirmText}
                              </bdi>
                            ),
                          })}
                        </p>
                        <Input mono value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmText} autoComplete="off" autoFocus />
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <Button ref={cancelRef} variant="secondary" onClick={handleClose} disabled={loading}>
                    {cancelLabel ?? t('confirm.cancel')}
                  </Button>
                  <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={handleConfirm} loading={loading} disabled={!canConfirm}>
                    {confirmLabel ?? t('confirm.confirm')}
                  </Button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

export default ConfirmDialog;
