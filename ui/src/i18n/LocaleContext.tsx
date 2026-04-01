import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ko } from "./translations/ko";
import { en } from "./translations/en";
import type { TranslationKeys } from "./translations/ko";

export type Locale = "ko" | "en";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKeys) => string;
}

const LOCALE_STORAGE_KEY = "paperclip.locale";
const DEFAULT_LOCALE: Locale = "ko";

const translations: Record<Locale, Record<TranslationKeys, string>> = { ko, en };

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

function resolveInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "ko" || stored === "en") return stored;
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((current) => (current === "ko" ? "en" : "ko"));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }, [locale]);

  const t = useCallback(
    (key: TranslationKeys): string => {
      return translations[locale][key] ?? translations["en"][key] ?? key;
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, toggleLocale, t }),
    [locale, setLocale, toggleLocale, t],
  );

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}
