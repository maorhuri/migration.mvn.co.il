import { cn } from '../../lib/cn';
import { LANG_LABELS, useLanguage, useT, type Lang } from '../../lib/i18n';

const LANGS: Lang[] = ['he', 'en'];

/** Compact "עברית | English" segmented control. Lives in the top bar; also reachable from the command palette. */
export function LanguageToggle({ className }: { className?: string }) {
  const t = useT();
  const { lang, setLang } = useLanguage();
  return (
    <div role="radiogroup" aria-label={t('lang.label')} className={cn('inline-flex h-8 items-center rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.06]', className)}>
      {LANGS.map((l) => {
        const active = l === lang;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={active}
            lang={l}
            onClick={() => setLang(l)}
            className={cn(
              'inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:focus-visible:ring-brand-300',
              active ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-50' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
            )}
          >
            {LANG_LABELS[l]}
          </button>
        );
      })}
    </div>
  );
}

export default LanguageToggle;
