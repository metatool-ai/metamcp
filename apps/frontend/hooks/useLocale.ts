import { useParams } from "next/navigation";

import { SUPPORTED_LOCALES, SupportedLocale } from "@/lib/i18n";

export function useLocale(): SupportedLocale {
  const params = useParams();
  const locale = params?.locale as string;

  if (locale && SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    return locale as SupportedLocale;
  }

  return "en";
}
