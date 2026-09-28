import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import en from "./locales/en.json";
import sw from "./locales/sw.json";

type Lang = "en" | "sw";
type Dict = Record<string, string>;

const dicts: Record<Lang, Dict> = { en, sw };

type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("en");

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const template = dicts[lang][key] ?? dicts.en[key] ?? key;
      if (!vars) return template;
      return Object.entries(vars).reduce(
        (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
        template,
      );
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
