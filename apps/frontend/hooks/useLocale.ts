import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { SUPPORTED_LOCALES, SupportedLocale } from "@/lib/i18n";

export function useLocale() {
  const pathname = usePathname();
  const [locale, setLocale] = useState<SupportedLocale>("en");

  useEffect(() => {
    const segments = pathname.split("/").filter(Boolean);
    const firstSegment = segments[0];

    if (SUPPORTED_LOCALES.includes(firstSegment as SupportedLocale)) {
      setLocale(firstSegment as SupportedLocale);
    } else {
      setLocale("en");
    }
  }, [pathname]);

  return locale;
}
