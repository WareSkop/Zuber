import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import enTranslations from '../locales/en.json';
import deTranslations from '../locales/de.json';

export type SupportedLanguage = 'en' | 'de';

export interface I18nContextType {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (key: string, paramsOrFallback?: Record<string, string | number> | string, fallback?: string) => string;
}

const STORAGE_KEY = 'zuber_language';

const dictionaries: Record<SupportedLanguage, any> = {
  en: enTranslations,
  de: deTranslations,
};

function getNestedValue(obj: any, path: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr && typeof curr === 'object' && part in curr) {
      curr = curr[part];
    } else {
      return undefined;
    }
  }
  return typeof curr === 'string' ? curr : undefined;
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    return params[key] !== undefined ? String(params[key]) : `{{${key}}}`;
  });
}

const I18nContext = createContext<I18nContextType>({
  language: 'en',
  setLanguage: () => {},
  t: (key, paramsOrFallback, fallback) => {
    const val = getNestedValue(dictionaries.en, key);
    if (val) {
      return typeof paramsOrFallback === 'object' ? interpolate(val, paramsOrFallback) : val;
    }
    if (typeof paramsOrFallback === 'string') return paramsOrFallback;
    if (typeof fallback === 'string') return fallback;
    return key;
  },
});

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('knowmesh_language');
        if (stored === 'de' || stored === 'en') {
          return stored;
        }
      } catch {}
    }
    return 'en'; // English is default and fallback
  });

  const setLanguage = useCallback((lang: SupportedLanguage) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, lang);
        document.documentElement.lang = lang;
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);

  const t = useCallback(
    (key: string, paramsOrFallback?: Record<string, string | number> | string, fallback?: string): string => {
      const defaultText = typeof paramsOrFallback === 'string' ? paramsOrFallback : fallback;
      const params = typeof paramsOrFallback === 'object' && paramsOrFallback !== null ? paramsOrFallback : undefined;

      // 1. Check current language dictionary
      const currentDict = dictionaries[language];
      let val = getNestedValue(currentDict, key);

      // 2. Fallback to English dictionary if not found in current language
      if (val === undefined && language !== 'en') {
        val = getNestedValue(dictionaries.en, key);
      }

      // 3. Fallback to defaultText or raw key if not found anywhere
      if (val === undefined) {
        return defaultText !== undefined ? defaultText : key;
      }

      return interpolate(val, params);
    },
    [language]
  );

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useTranslation = (): I18nContextType => {
  return useContext(I18nContext);
};
