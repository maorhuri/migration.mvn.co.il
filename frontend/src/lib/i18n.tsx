import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { dictionaries } from '../i18n';

export type Lang = 'he' | 'en';
export type Dir = 'rtl' | 'ltr';
export type Locale = 'he-IL' | 'en-US';

export const LANG_STORAGE_KEY = 'lang';
export const LANG_LABELS: Record<Lang, string> = { he: 'עברית', en: 'English' };
const LOCALES: Record<Lang, Locale> = { he: 'he-IL', en: 'en-US' };
const DEFAULT_LANG: Lang = 'he';

export type TVars = Record<string, string | number>;
export type T = ((key: string, vars?: TVars) => string) & {
  /** Interpolate React nodes: t.rich('confirm.typeToConfirm', { text: <code>x</code> }). */
  rich: (key: string, vars: Record<string, ReactNode>) => ReactNode;
};

// ---------------------------------------------------------------------------
// Module-level state so non-React code (src/lib/format.ts) can format for the active language.
// ---------------------------------------------------------------------------

let currentLang: Lang = DEFAULT_LANG;

function isLang(v: unknown): v is Lang {
  return v === 'he' || v === 'en';
}

export function dirOf(lang: Lang): Dir {
  return lang === 'he' ? 'rtl' : 'ltr';
}

/** Active language without hooks (formatters). Prefer `useLanguage()` in components. */
export function getLang(): Lang {
  return currentLang;
}

/** Active BCP-47 locale for Intl: 'he-IL' or 'en-US'. */
export function getLocale(): Locale {
  return LOCALES[currentLang];
}

/** Set the active language for non-hook consumers. The provider calls this; pages never need to. */
export function setLocale(lang: Lang | Locale): void {
  currentLang = lang === 'he-IL' ? 'he' : lang === 'en-US' ? 'en' : lang;
}

function readInitialLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (isLang(q)) {
      localStorage.setItem(LANG_STORAGE_KEY, q);
      return q;
    }
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* localStorage or URL unavailable */
  }
  return DEFAULT_LANG;
}

function applyToDocument(lang: Lang) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = dirOf(lang);
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const warned = new Set<string>();

function lookup(lang: Lang, key: string, vars?: TVars | Record<string, ReactNode>): string {
  let k = key;
  const count = vars?.count;
  if (typeof count === 'number') {
    const plural = `${key}_${count === 1 ? 'one' : 'other'}`;
    if (dictionaries[lang][plural] !== undefined || dictionaries.en[plural] !== undefined) k = plural;
  }
  let text = dictionaries[lang][k];
  if (text === undefined) {
    text = dictionaries.en[k];
    if (import.meta.env.DEV && !warned.has(`${lang}:${k}`)) {
      warned.add(`${lang}:${k}`);
      console.warn(`[i18n] missing "${k}" for "${lang}"${text === undefined ? ' (and en)' : ', using en'}`);
    }
  }
  return text ?? k;
}

const TOKEN = /\{(\w+)\}/g;

function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(TOKEN, (m, name: string) => (vars[name] !== undefined ? String(vars[name]) : m));
}

function interpolateRich(template: string, vars: Record<string, ReactNode>): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of template.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(template.slice(last, idx));
    const name = m[1];
    parts.push(name in vars ? <Fragment key={i++}>{vars[name]}</Fragment> : m[0]);
    last = idx + m[0].length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function makeT(lang: Lang): T {
  const t = ((key: string, vars?: TVars) => interpolate(lookup(lang, key, vars), vars)) as T;
  t.rich = (key, vars) => interpolateRich(lookup(lang, key, vars), vars);
  return t;
}

/** Translate without hooks (formatters, toasts fired outside components). */
export function translate(key: string, vars?: TVars): string {
  return interpolate(lookup(currentLang, key, vars), vars);
}

// ---------------------------------------------------------------------------
// Provider + hooks
// ---------------------------------------------------------------------------

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  dir: Dir;
  locale: Locale;
  t: T;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Provides the active language (Hebrew by default), persists it under localStorage "lang",
 * honours `?lang=he|en` on first load, and mirrors `lang` / `dir` onto `<html>`.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const initial = readInitialLang();
    setLocale(initial);
    return initial;
  });

  useLayoutEffect(() => {
    setLocale(lang);
    applyToDocument(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLocale(next);
    setLangState(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, dir: dirOf(lang), locale: LOCALES[lang], t: makeT(lang) }),
    [lang, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

function useLanguageContext(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage/useT must be used within <LanguageProvider>');
  return ctx;
}

/** `{ lang, setLang, dir, locale }` for the active language. */
export function useLanguage(): { lang: Lang; setLang: (lang: Lang) => void; dir: Dir; locale: Locale } {
  const { lang, setLang, dir, locale } = useLanguageContext();
  return { lang, setLang, dir, locale };
}

/**
 * Translator for the active language. `t('key', { name })` interpolates `{name}`;
 * `t('units.files', { count })` picks `units.files_one` / `units.files_other`;
 * `t.rich('key', { text: <b>x</b> })` interpolates React nodes.
 */
export function useT(): T {
  return useLanguageContext().t;
}
