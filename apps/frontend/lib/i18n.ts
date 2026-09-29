// Client-side i18n utilities
export const SUPPORTED_LOCALES = ["en", "fr", "zh", "ko", "pt", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NAMES = {
  en: "English",
  fr: "Français",
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
  admin: Record<string, TranslationValue>;
  access: Record<string, TranslationValue>;
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
      admin: (await import("../public/locales/en/admin.json")).default,
      access: (await import("../public/locales/en/access.json")).default,
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
      common: withFallback(englishDict.common, commonZh.default),
      auth: withFallback(englishDict.auth, authZh.default),
      navigation: withFallback(englishDict.navigation, navigationZh.default),
      "mcp-servers": withFallback(
        englishDict["mcp-servers"],
        mcpServersZh.default,
      ),
      namespaces: withFallback(englishDict.namespaces, namespacesZh.default),
      endpoints: withFallback(englishDict.endpoints, endpointsZh.default),
      "api-keys": withFallback(englishDict["api-keys"], apiKeysZh.default),
      settings: withFallback(englishDict.settings, settingsZh.default),
      search: withFallback(englishDict.search, searchZh.default),
      inspector: withFallback(englishDict.inspector, inspectorZh.default),
      logs: withFallback(englishDict.logs, logsZh.default),
      "audit-logs": withFallback(
        englishDict["audit-logs"],
        auditLogsZh.default,
      ),
      validation: withFallback(englishDict.validation, validationZh.default),
      admin: { ...englishDict.admin },
      access: { ...englishDict.access },
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
      common: withFallback(englishDict.common, commonKo.default),
      auth: withFallback(englishDict.auth, authKo.default),
      navigation: withFallback(englishDict.navigation, navigationKo.default),
      "mcp-servers": withFallback(
        englishDict["mcp-servers"],
        mcpServersKo.default,
      ),
      namespaces: withFallback(englishDict.namespaces, namespacesKo.default),
      endpoints: withFallback(englishDict.endpoints, endpointsKo.default),
      "api-keys": withFallback(englishDict["api-keys"], apiKeysKo.default),
      settings: withFallback(englishDict.settings, settingsKo.default),
      search: withFallback(englishDict.search, searchKo.default),
      inspector: withFallback(englishDict.inspector, inspectorKo.default),
      logs: withFallback(englishDict.logs, logsKo.default),
      "audit-logs": withFallback(
        englishDict["audit-logs"],
        auditLogsKo.default,
      ),
      validation: withFallback(englishDict.validation, validationKo.default),
      admin: { ...englishDict.admin },
      access: { ...englishDict.access },
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
      common: withFallback(englishDict.common, commonPt.default),
      auth: withFallback(englishDict.auth, authPt.default),
      navigation: withFallback(englishDict.navigation, navigationPt.default),
      "mcp-servers": withFallback(
        englishDict["mcp-servers"],
        mcpServersPt.default,
      ),
      namespaces: withFallback(englishDict.namespaces, namespacesPt.default),
      endpoints: withFallback(englishDict.endpoints, endpointsPt.default),
      "api-keys": withFallback(englishDict["api-keys"], apiKeysPt.default),
      settings: withFallback(englishDict.settings, settingsPt.default),
      search: withFallback(englishDict.search, searchPt.default),
      inspector: withFallback(englishDict.inspector, inspectorPt.default),
      logs: withFallback(englishDict.logs, logsPt.default),
      validation: withFallback(englishDict.validation, validationPt.default),
      "audit-logs": { ...englishDict["audit-logs"] },
      admin: { ...englishDict.admin },
      access: { ...englishDict.access },
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
      common: withFallback(englishDict.common, commonEs.default),
      auth: withFallback(englishDict.auth, authEs.default),
      navigation: withFallback(englishDict.navigation, navigationEs.default),
      "mcp-servers": withFallback(
        englishDict["mcp-servers"],
        mcpServersEs.default,
      ),
      namespaces: withFallback(englishDict.namespaces, namespacesEs.default),
      endpoints: withFallback(englishDict.endpoints, endpointsEs.default),
      "api-keys": withFallback(englishDict["api-keys"], apiKeysEs.default),
      settings: withFallback(englishDict.settings, settingsEs.default),
      search: withFallback(englishDict.search, searchEs.default),
      inspector: withFallback(englishDict.inspector, inspectorEs.default),
      logs: withFallback(englishDict.logs, logsEs.default),
      validation: withFallback(englishDict.validation, validationEs.default),
      "audit-logs": { ...englishDict["audit-logs"] },
      admin: { ...englishDict.admin },
      access: { ...englishDict.access },
    };
  } else if (locale === "fr") {
    // French: every namespace, deep-merged over English so that a key added
    // later in English shows in English rather than as a raw key.
    const load = (namespace: Promise<{ default: unknown }>) =>
      namespace
        .then((module) => module.default as Record<string, TranslationValue>)
        .catch(() => ({}));
    const [
      common,
      auth,
      navigation,
      mcpServers,
      namespaces,
      endpoints,
      apiKeys,
      settings,
      search,
      inspector,
      logs,
      auditLogs,
      validation,
      admin,
      access,
    ] = await Promise.all([
      load(import("../public/locales/fr/common.json")),
      load(import("../public/locales/fr/auth.json")),
      load(import("../public/locales/fr/navigation.json")),
      load(import("../public/locales/fr/mcp-servers.json")),
      load(import("../public/locales/fr/namespaces.json")),
      load(import("../public/locales/fr/endpoints.json")),
      load(import("../public/locales/fr/api-keys.json")),
      load(import("../public/locales/fr/settings.json")),
      load(import("../public/locales/fr/search.json")),
      load(import("../public/locales/fr/inspector.json")),
      load(import("../public/locales/fr/logs.json")),
      load(import("../public/locales/fr/audit-logs.json")),
      load(import("../public/locales/fr/validation.json")),
      load(import("../public/locales/fr/admin.json")),
      load(import("../public/locales/fr/access.json")),
    ]);
    const en = await loadTranslations("en");

    return {
      common: withFallback(en.common, common),
      auth: withFallback(en.auth, auth),
      navigation: withFallback(en.navigation, navigation),
      "mcp-servers": withFallback(en["mcp-servers"], mcpServers),
      namespaces: withFallback(en.namespaces, namespaces),
      endpoints: withFallback(en.endpoints, endpoints),
      "api-keys": withFallback(en["api-keys"], apiKeys),
      settings: withFallback(en.settings, settings),
      search: withFallback(en.search, search),
      inspector: withFallback(en.inspector, inspector),
      logs: withFallback(en.logs, logs),
      "audit-logs": withFallback(en["audit-logs"], auditLogs),
      validation: withFallback(en.validation, validation),
      admin: withFallback(en.admin, admin),
      access: withFallback(en.access, access),
    };
  } else {
    // Fallback to English for unsupported locales
    return loadTranslations("en");
  }
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Deep merge of a localized dictionary over its English fallback. */
function withFallback(
  fallback: Record<string, TranslationValue>,
  localized: Record<string, TranslationValue>,
): Record<string, TranslationValue> {
  const result: Record<string, TranslationValue> = { ...fallback };
  for (const [key, value] of Object.entries(localized)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const base = Object.hasOwn(fallback, key) ? fallback[key] : undefined;
    result[key] =
      value && typeof value === "object" && base && typeof base === "object"
        ? withFallback(base, value)
        : value;
  }
  return result;
}

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralCategory(locale: string, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules("en");
    }
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

// Helper function to get nested translation value
export function getTranslation(
  dictionary: Translations,
  key: string,
  params?: Record<string, string | number>,
  locale: string = "en",
): string {
  const parts = key.split(":");
  let value: unknown = dictionary;

  // First, navigate to the correct namespace (before the colon)
  if (parts.length > 1) {
    const namespace = parts[0]!;
    if (value && typeof value === "object" && Object.hasOwn(value, namespace)) {
      value = (value as Record<string, unknown>)[namespace];
    } else {
      return key; // Return the key if namespace not found
    }

    // Then navigate through the nested structure using dots
    const nestedKeys = parts[1]!.split(".");
    for (const k of nestedKeys) {
      if (value && typeof value === "object" && Object.hasOwn(value, k)) {
        // Read-only walk through own properties: no pollution.
        // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
        value = (value as Record<string, unknown>)[k];
      } else {
        return key; // Return the key if translation not found
      }
    }
  } else {
    // Handle keys without namespace (legacy support)
    const keys = key.split(".");
    for (const k of keys) {
      if (value && typeof value === "object" && Object.hasOwn(value, k)) {
        // Read-only walk through own properties: no pollution.
        // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
        value = (value as Record<string, unknown>)[k];
      } else {
        return key; // Return the key if translation not found
      }
    }
  }

  // Plural forms ({ "one": "...", "other": "..." }, optionally "zero",
  // "few", "many") selected by params.count with the locale's plural rules:
  // French uses "one" for 0 and 1, English only for 1.
  if (
    value &&
    typeof value === "object" &&
    Object.hasOwn(value, "other") &&
    typeof params?.count === "number"
  ) {
    const forms = value as Record<string, unknown>;
    const category = pluralCategory(locale, params.count);
    value = Object.hasOwn(forms, category) ? forms[category] : forms.other;
  }

  if (typeof value !== "string") {
    return key; // Return the key if the final value is not a string
  }

  // Simple parameter interpolation
  if (params) {
    return value.replace(/\{\{(\w+)\}\}/g, (match, paramKey) => {
      // An empty string is a value (e.g. `plural: ""`); only missing
      // parameters leave the placeholder visible.
      const param = Object.hasOwn(params, paramKey)
        ? params[paramKey]
        : undefined;
      return param === undefined || param === null ? match : String(param);
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
