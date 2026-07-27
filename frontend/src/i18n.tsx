/**
 * Lightweight i18n for the AdConnect prototype.
 *
 * Design goals:
 *  - Inline, co-located translations: `t("Русский", "English")` instead of a
 *    separate key catalog — easy to read next to the markup it localizes.
 *  - Usable both inside components (via `useLang`) and inside plain render-time
 *    helper functions / module-level label getters (via the standalone `t`),
 *    because `t` reads a module-level `currentLang` that the provider keeps in
 *    sync. Any lang change re-renders the whole tree (the provider holds the
 *    language in state and nothing below is memoized), so standalone `t` calls
 *    re-evaluate with the new language.
 *
 * Scope: static UI strings only. Text produced by the backend (Copilot chat
 * messages, agent traces) stays in the server's language.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "ru" | "en";

const STORAGE_KEY = "adconnect_lang";
const DEFAULT_LANG: Lang = "en";

function readInitial(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "ru" || v === "en") return v;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return DEFAULT_LANG;
}

// Module-level current language, kept in sync by the provider. Lets standalone
// `t()` (below) work from non-component render-time code paths.
let currentLang: Lang = readInitial();

/** Standalone translator. Returns the string for the active language. */
export function t(ru: string, en: string): string {
  return currentLang === "en" ? en : ru;
}

/** Current active language, for non-reactive reads. */
export function getLang(): Lang {
  return currentLang;
}

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  /** Reactive translator, identical to the standalone `t`. */
  t: (ru: string, en: string) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang);

  const setLang = useCallback((next: Lang) => {
    currentLang = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence errors */
    }
    setLangState(next);
  }, []);

  const value = useMemo<LangContextValue>(
    () => ({
      lang,
      setLang,
      toggle: () => setLang(lang === "en" ? "ru" : "en"),
      t: (ru: string, en: string) => (lang === "en" ? en : ru),
    }),
    [lang, setLang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within a LangProvider");
  return ctx;
}
