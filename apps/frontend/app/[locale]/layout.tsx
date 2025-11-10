import { notFound } from "next/navigation";
import { ReactNode } from "react";

import { TranslationsProvider } from "@/context/TranslationsContext";
import {
  loadTranslations,
  SUPPORTED_LOCALES,
  SupportedLocale,
} from "../../lib/i18n";

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  // Validate that the locale is supported
  if (!SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    notFound();
  }

  // Load translations on the server
  const translations = await loadTranslations(locale as SupportedLocale);

  return (
    <div lang={locale}>
      <TranslationsProvider translations={translations} locale={locale as SupportedLocale}>
        {children}
      </TranslationsProvider>
    </div>
  );
}
