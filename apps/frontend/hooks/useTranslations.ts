import { getTranslation } from "@/lib/i18n";

import { useTranslationsContext } from "../context/TranslationsContext";

export function useTranslations() {
  const { translations, locale } = useTranslationsContext();

  const t = (key: string, params?: Record<string, string | number>) => {
    return getTranslation(translations, key, params);
  };

  return { t, locale };
}
