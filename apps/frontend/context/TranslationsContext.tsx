"use client";

import React, { createContext, useContext } from "react";

import { SupportedLocale, Translations } from "@/lib/i18n";

interface TranslationsContextValue {
  translations: Translations;
  locale: SupportedLocale;
}

const TranslationsContext = createContext<TranslationsContextValue | null>(
  null,
);

export function TranslationsProvider({
  children,
  translations,
  locale,
}: {
  children: React.ReactNode;
  translations: Translations;
  locale: SupportedLocale;
}) {
  return (
    <TranslationsContext.Provider value={{ translations, locale }}>
      {children}
    </TranslationsContext.Provider>
  );
}

export function useTranslationsContext() {
  const context = useContext(TranslationsContext);
  if (!context) {
    throw new Error(
      "useTranslationsContext must be used within TranslationsProvider",
    );
  }
  return context;
}
