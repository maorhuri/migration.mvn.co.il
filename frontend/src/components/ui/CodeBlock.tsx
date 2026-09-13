import { useState, type ReactNode } from 'react';
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/16/solid';
import toast from 'react-hot-toast';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';

export interface CodeBlockProps {
  /** Text to display and copy. */
  code: string;
  /** Small caption in the block header (e.g. "/etc/hosts"). */
  title?: ReactNode;
  /** Language hint shown in the header (display only). */
  language?: string;
  /** Wrap long lines (default: wrap). */
  wrap?: boolean;
  /** Hide the copy button. */
  noCopy?: boolean;
  /** Toast text on copy. */
  copiedMessage?: string;
  /** Inline single-line variant (no header). */
  inline?: boolean;
  className?: string;
}

export async function copyToClipboard(text: string, message = 'Copied to clipboard'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
    return true;
  } catch {
    toast.error('Could not copy');
    return false;
  }
}

/**
 * Monospace block with a copy button. Use for hosts entries, commands, ids.
 * Always dark (slate-950) in both themes so it reads as "terminal".
 */
export function CodeBlock({ code, title, language, wrap = true, noCopy, copiedMessage, inline, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(code, copiedMessage);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (inline) {
    return (
      <span className={cn('inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 pl-2 dark:border-slate-700 dark:bg-slate-800', className)}>
        <code className="truncate py-0.5 font-mono text-xs text-slate-800 dark:text-slate-200">{code}</code>
        {!noCopy && <IconButton aria-label="Copy" icon={copied ? <CheckIcon className="text-emerald-500" /> : <ClipboardDocumentIcon />} size="xs" onClick={handleCopy} />}
      </span>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-slate-800 bg-slate-950 text-slate-100 shadow-sm dark:border-slate-700', className)}>
      {(title || language || !noCopy) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
            {title && <span className="truncate font-mono text-slate-300">{title}</span>}
            {language && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-2xs uppercase tracking-wide">{language}</span>}
          </div>
          {!noCopy && (
            <IconButton
              aria-label={copied ? 'Copied' : 'Copy to clipboard'}
              icon={copied ? <CheckIcon className="text-emerald-400" /> : <ClipboardDocumentIcon />}
              size="xs"
              onClick={handleCopy}
              className="text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            />
          )}
        </div>
      )}
      <pre className={cn('overflow-x-auto px-3 py-2.5 font-mono text-[13px] leading-relaxed text-emerald-300', wrap && 'whitespace-pre-wrap break-all')}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default CodeBlock;
