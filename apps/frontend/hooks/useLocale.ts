import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { SUPPORTED_LOCALES, SupportedLocale } from "@/lib/i18n";

export function useLocale() {
  const pathname = usePathname();
  const [locale, setLocale] = useState<SupportedLocale>("en");

  useEffect(() => {
    const segments = pathname.split("/").filter(Boolean);
    const firstSegment = segments[0];

    console.log("[useLocale] pathname:", pathname);
    console.log("[useLocale] segments:", segments);
    console.log("[useLocale] firstSegment:", firstSegment);

    if (SUPPORTED_LOCALES.includes(firstSegment as SupportedLocale)) {
      console.log("[useLocale] Setting locale to:", firstSegment);
      setLocale(firstSegment as SupportedLocale);
    } else {
      console.log("[useLocale] Setting locale to default: en");
      setLocale("en");
    }
  }, [pathname]);

  return locale;
}
