// Client-side i18n utilities
export const SUPPORTED_LOCALES = ["en", "zh", "ko", "pt", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NAMES = {
  en: "English",
  zh: "中文",
  ko: "한국어",
  pt: "Português",
  es: "Español",
} as const;

// Translation dictionaries are arbitrarily nested string trees loaded from JSON
export type TranslationValue = string | { [key: string]: TranslationValue };

// Type for translations
export type Translations = {
  common: Record<string, TranslationValue>;
  auth: Record<string, TranslationValue>;
  navigation: Record<string, TranslationValue>;
  "mcp-servers": Record<string, TranslationValue>;
  namespaces: Record<string, TranslationValue>;
  endpoints: Record<string, TranslationValue>;
  "api-keys": Record<string, TranslationValue>;
  settings: Record<string, TranslationValue>;
  search: Record<string, TranslationValue>;
  inspector: Record<string, TranslationValue>;
  logs: Record<string, TranslationValue>;
  "audit-logs": Record<string, TranslationValue>;
  validation: Record<string, TranslationValue>;
};

// Utility functions for working with localized paths
export function getPathnameWithoutLocale(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0];

  if (SUPPORTED_LOCALES.includes(firstSegment as SupportedLocale)) {
    return "/" + segments.slice(1).join("/");
  }

  return pathname;
}

export function getLocalizedPath(
  pathname: string,
  locale: SupportedLocale,
): string {
  const pathnameWithoutLocale = getPathnameWithoutLocale(pathname);

  if (locale === "en") {
    return pathnameWithoutLocale;
  }

  return `/${locale}${pathnameWithoutLocale === "/" ? "" : pathnameWithoutLocale}`;
}

// Client-side translation loader (for dynamic imports)
export async function loadTranslations(
  locale: SupportedLocale,
): Promise<Translations> {
  if (locale === "en") {
    return {
      common: (await import("../public/locales/en/common.json")).default,
      auth: (await import("../public/locales/en/auth.json")).default,
      navigation: (await import("../public/locales/en/navigation.json"))
        .default,
      "mcp-servers": (await import("../public/locales/en/mcp-servers.json"))
        .default,
      namespaces: (await import("../public/locales/en/namespaces.json"))
        .default,
      endpoints: (await import("../public/locales/en/endpoints.json")).default,
      "api-keys": (await import("../public/locales/en/api-keys.json")).default,
      settings: (await import("../public/locales/en/settings.json")).default,
      search: (await import("../public/locales/en/search.json")).default,
      inspector: (await import("../public/locales/en/inspector.json")).default,
      logs: (await import("../public/locales/en/logs.json")).default,
      "audit-logs": (await import("../public/locales/en/audit-logs.json"))
        .default,
      validation: (await import("../public/locales/en/validation.json"))
        .default,
    };
  } else if (locale === "zh") {
    // Load Chinese translations with fallback to English
    const [
      commonZh,
      authZh,
      navigationZh,
      mcpServersZh,
      namespacesZh,
      endpointsZh,
      apiKeysZh,
      settingsZh,
      searchZh,
      inspectorZh,
      logsZh,
      auditLogsZh,
      validationZh,
    ] = await Promise.all([
      import("../public/locales/zh/common.json").catch(() => ({ default: {} })),
      import("../public/locales/zh/auth.json").catch(() => ({ default: {} })),
      import("../public/locales/zh/navigation.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/zh/mcp-servers.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/zh/namespaces.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/zh/endpoints.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/zh/api-keys.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/zh/settings.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/zh/search.json").catch(() => ({ default: {} })),
      import("../public/locales/zh/inspector.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/zh/logs.json").catch(() => ({ default: {} })),
      import("../public/locales/zh/audit-logs.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/zh/validation.json").catch(() => ({
        default: {},
      })),
    ]);

    // Get English fallback
    const englishDict = await loadTranslations("en");

    return {
      common: { ...englishDict.common, ...commonZh.default },
      auth: { ...englishDict.auth, ...authZh.default },
      navigation: { ...englishDict.navigation, ...navigationZh.default },
      "mcp-servers": { ...englishDict["mcp-servers"], ...mcpServersZh.default },
      namespaces: { ...englishDict.namespaces, ...namespacesZh.default },
      endpoints: { ...englishDict.endpoints, ...endpointsZh.default },
      "api-keys": { ...englishDict["api-keys"], ...apiKeysZh.default },
      settings: { ...englishDict.settings, ...settingsZh.default },
      search: { ...englishDict.search, ...searchZh.default },
      inspector: { ...englishDict.inspector, ...inspectorZh.default },
      logs: { ...englishDict.logs, ...logsZh.default },
      "audit-logs": {
        ...englishDict["audit-logs"],
        ...auditLogsZh.default,
      },
      validation: { ...englishDict.validation, ...validationZh.default },
    };
  } else if (locale === "ko") {
    // Load Korean translations with fallback to English
    const [
      commonKo,
      authKo,
      navigationKo,
      mcpServersKo,
      namespacesKo,
      endpointsKo,
      apiKeysKo,
      settingsKo,
      searchKo,
      inspectorKo,
      logsKo,
      auditLogsKo,
      validationKo,
    ] = await Promise.all([
      import("../public/locales/ko/common.json").catch(() => ({ default: {} })),
      import("../public/locales/ko/auth.json").catch(() => ({ default: {} })),
      import("../public/locales/ko/navigation.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/ko/mcp-servers.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/ko/namespaces.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/ko/endpoints.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/ko/api-keys.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/ko/settings.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/ko/search.json").catch(() => ({ default: {} })),
      import("../public/locales/ko/inspector.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/ko/logs.json").catch(() => ({ default: {} })),
      import("../public/locales/ko/audit-logs.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/ko/validation.json").catch(() => ({
        default: {},
      })),
    ]);

    // Get English fallback
    const englishDict = await loadTranslations("en");

    return {
      common: { ...englishDict.common, ...commonKo.default },
      auth: { ...englishDict.auth, ...authKo.default },
      navigation: { ...englishDict.navigation, ...navigationKo.default },
      "mcp-servers": { ...englishDict["mcp-servers"], ...mcpServersKo.default },
      namespaces: { ...englishDict.namespaces, ...namespacesKo.default },
      endpoints: { ...englishDict.endpoints, ...endpointsKo.default },
      "api-keys": { ...englishDict["api-keys"], ...apiKeysKo.default },
      settings: { ...englishDict.settings, ...settingsKo.default },
      search: { ...englishDict.search, ...searchKo.default },
      inspector: { ...englishDict.inspector, ...inspectorKo.default },
      logs: { ...englishDict.logs, ...logsKo.default },
      "audit-logs": {
        ...englishDict["audit-logs"],
        ...auditLogsKo.default,
      },
      validation: { ...englishDict.validation, ...validationKo.default },
    };
  } else if (locale === "pt") {
    // Load Portuguese translations with fallback to English
    const [
      commonPt,
      authPt,
      navigationPt,
      mcpServersPt,
      namespacesPt,
      endpointsPt,
      apiKeysPt,
      settingsPt,
      searchPt,
      inspectorPt,
      logsPt,
      validationPt,
    ] = await Promise.all([
      import("../public/locales/pt/common.json").catch(() => ({ default: {} })),
      import("../public/locales/pt/auth.json").catch(() => ({ default: {} })),
      import("../public/locales/pt/navigation.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/pt/mcp-servers.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/pt/namespaces.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/pt/endpoints.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/pt/api-keys.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/pt/settings.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/pt/search.json").catch(() => ({ default: {} })),
      import("../public/locales/pt/inspector.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/pt/logs.json").catch(() => ({ default: {} })),
      import("../public/locales/pt/validation.json").catch(() => ({
        default: {},
      })),
    ]);

    // Get English fallback
    const englishDict = await loadTranslations("en");

    return {
      common: { ...englishDict.common, ...commonPt.default },
      auth: { ...englishDict.auth, ...authPt.default },
      navigation: { ...englishDict.navigation, ...navigationPt.default },
      "mcp-servers": { ...englishDict["mcp-servers"], ...mcpServersPt.default },
      namespaces: { ...englishDict.namespaces, ...namespacesPt.default },
      endpoints: { ...englishDict.endpoints, ...endpointsPt.default },
      "api-keys": { ...englishDict["api-keys"], ...apiKeysPt.default },
      settings: { ...englishDict.settings, ...settingsPt.default },
      search: { ...englishDict.search, ...searchPt.default },
      inspector: { ...englishDict.inspector, ...inspectorPt.default },
      logs: { ...englishDict.logs, ...logsPt.default },
      validation: { ...englishDict.validation, ...validationPt.default },
      "audit-logs": { ...englishDict["audit-logs"] },
    };
  } else if (locale === "es") {
    // Load Spanish translations with fallback to English
    const [
      commonEs,
      authEs,
      navigationEs,
      mcpServersEs,
      namespacesEs,
      endpointsEs,
      apiKeysEs,
      settingsEs,
      searchEs,
      inspectorEs,
      logsEs,
      validationEs,
    ] = await Promise.all([
      import("../public/locales/es/common.json").catch(() => ({ default: {} })),
      import("../public/locales/es/auth.json").catch(() => ({ default: {} })),
      import("../public/locales/es/navigation.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/es/mcp-servers.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/es/namespaces.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/es/endpoints.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/es/api-keys.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/es/settings.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/es/search.json").catch(() => ({ default: {} })),
      import("../public/locales/es/inspector.json").catch(() => ({
        default: {},
      })),
      import("../public/locales/es/logs.json").catch(() => ({ default: {} })),
      import("../public/locales/es/validation.json").catch(() => ({
        default: {},
      })),
    ]);

    // Get English fallback
    const englishDict = await loadTranslations("en");

    return {
      common: { ...englishDict.common, ...commonEs.default },
      auth: { ...englishDict.auth, ...authEs.default },
      navigation: { ...englishDict.navigation, ...navigationEs.default },
      "mcp-servers": { ...englishDict["mcp-servers"], ...mcpServersEs.default },
      namespaces: { ...englishDict.namespaces, ...namespacesEs.default },
      endpoints: { ...englishDict.endpoints, ...endpointsEs.default },
      "api-keys": { ...englishDict["api-keys"], ...apiKeysEs.default },
      settings: { ...englishDict.settings, ...settingsEs.default },
      search: { ...englishDict.search, ...searchEs.default },
      inspector: { ...englishDict.inspector, ...inspectorEs.default },
      logs: { ...englishDict.logs, ...logsEs.default },
      validation: { ...englishDict.validation, ...validationEs.default },
      "audit-logs": { ...englishDict["audit-logs"] },
    };
  } else {
    // Fallback to English for unsupported locales
    return loadTranslations("en");
  }
}

// Helper function to get nested translation value
export function getTranslation(
  dictionary: Translations,
  key: string,
  params?: Record<string, string | number>,
): string {
  const parts = key.split(":");
  let value: unknown = dictionary;

  // First, navigate to the correct namespace (before the colon)
  if (parts.length > 1) {
    const namespace = parts[0]!;
    if (value && typeof value === "object" && namespace in value) {
      value = (value as Record<string, unknown>)[namespace];
    } else {
      return key; // Return the key if namespace not found
    }

    // Then navigate through the nested structure using dots
    const nestedKeys = parts[1]!.split(".");
    for (const k of nestedKeys) {
      if (value && typeof value === "object" && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        return key; // Return the key if translation not found
      }
    }
  } else {
    // Handle keys without namespace (legacy support)
    const keys = key.split(".");
    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        return key; // Return the key if translation not found
      }
    }
  }

  if (typeof value !== "string") {
    return key; // Return the key if the final value is not a string
  }

  // Simple parameter interpolation
  if (params) {
    return value.replace(/\{\{(\w+)\}\}/g, (match, paramKey) => {
      return params[paramKey]?.toString() || match;
    });
  }

  return value;
}

// Supported key formats:
// - "namespace:key" - simple namespace with key
// - "namespace:nested.key" - namespace with nested key using dots
// - "namespace:deeply.nested.key.path" - namespace with deeply nested key path
// - "key" - legacy format without namespace (uses dots for nesting)
// Example: "search:dialog.form.ownership.private" will access dictionary.search.dialog.form.ownership.private
