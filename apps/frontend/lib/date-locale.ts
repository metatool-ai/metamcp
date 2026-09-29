import type { Locale } from "date-fns";
import { enUS, es, fr, ko, ptBR, zhCN } from "date-fns/locale";

import type { SupportedLocale } from "./i18n";

const DATE_LOCALES: Record<SupportedLocale, Locale> = {
  en: enUS,
  fr,
  zh: zhCN,
  ko,
  // The Portuguese translation is Brazilian Portuguese.
  pt: ptBR,
  es,
};

/** date-fns locale of a UI language (relative times, month names). */
export function dateLocale(locale: string): Locale {
  return DATE_LOCALES[locale as SupportedLocale] ?? enUS;
}
