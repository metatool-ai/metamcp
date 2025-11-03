import { useParams } from "next/navigation";

import { SUPPORTED_LOCALES, SupportedLocale } from "@/lib/i18n";

export function useLocale(): SupportedLocale {
  const params = useParams();
  const locale = params?.locale as string;

  console.log("[useLocale] params:", params);
  console.log("[useLocale] locale from params:", locale);

  if (locale && SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    console.log("[useLocale] Returning locale:", locale);
    return locale as SupportedLocale;
  }

  console.log("[useLocale] Returning default: en");
  return "en";
}
