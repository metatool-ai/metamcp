// Client-side i18n utilities
export const SUPPORTED_LOCALES = ["en", "zh"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NAMES = {
  en: "English",
  zh: "中文",
} as const;

// Type for translations
export type Translations = {
  common: Record<string, any>;
  auth: Record<string, any>;
  navigation: Record<string, any>;
  "mcp-servers": Record<string, any>;
  namespaces: Record<string, any>;
  endpoints: Record<string, any>;
  "api-keys": Record<string, any>;
  "oauth-clients": Record<string, any>;
  settings: Record<string, any>;
  search: Record<string, any>;
  inspector: Record<string, any>;
  logs: Record<string, any>;
  validation: Record<string, any>;
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

  // Always add locale prefix for all locales (including "en")
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
      "oauth-clients": (await import("../public/locales/en/oauth-clients.json"))
        .default,
      settings: (await import("../public/locales/en/settings.json")).default,
      search: (await import("../public/locales/en/search.json")).default,
      inspector: (await import("../public/locales/en/inspector.json")).default,
      logs: (await import("../public/locales/en/logs.json")).default,
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
      oauthClientsZh,
      settingsZh,
      searchZh,
      inspectorZh,
      logsZh,
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
      import("../public/locales/zh/oauth-clients.json").catch(() => ({
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
      "oauth-clients": { ...englishDict["oauth-clients"], ...oauthClientsZh.default },
      settings: { ...englishDict.settings, ...settingsZh.default },
      search: { ...englishDict.search, ...searchZh.default },
      inspector: { ...englishDict.inspector, ...inspectorZh.default },
      logs: { ...englishDict.logs, ...logsZh.default },
      validation: { ...englishDict.validation, ...validationZh.default },
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
  let value: any = dictionary;

  // First, navigate to the correct namespace (before the colon)
  if (parts.length > 1) {
    const namespace = parts[0]!;
    if (value && typeof value === "object" && namespace in value) {
      value = value[namespace];
    } else {
      return key; // Return the key if namespace not found
    }

    // Then navigate through the nested structure using dots
    const nestedKeys = parts[1]!.split(".");
    for (const k of nestedKeys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        return key; // Return the key if translation not found
      }
    }
  } else {
    // Handle keys without namespace (legacy support)
    const keys = key.split(".");
    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
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
