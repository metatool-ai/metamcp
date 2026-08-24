import { notFound } from "next/navigation";
import { ReactNode } from "react";

import { SUPPORTED_LOCALES, SupportedLocale } from "../../lib/i18n";

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

  return <div lang={locale}>{children}</div>;
}
