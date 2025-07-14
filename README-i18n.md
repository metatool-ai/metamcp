# Internationalization (i18n) Setup

This projects uses Next.js locale in middleware and client side translation.

Default locale is en (English) while zh (Simplified Chinese) is supported. The author can recognize both languages so can better support the translation accuracy there, but you are welcomed to contribute more languages following this doc.

## Project Structure

```
apps/frontend/
├── app/
│   └── [locale]/                  # Locale-based routing
│       ├── layout.tsx            # Locale layout
│       ├── login/
│       ├── (sidebar)/            # Sidebar layout group
│       │   ├── layout.tsx
│       │   ├── mcp-servers/
│       │   ├── namespaces/
│       │   └── ...
│       └── ...
├── public/locales/
│   ├── en/                       # English translations
│   │   ├── common.json
│   │   ├── auth.json
│   │   ├── navigation.json
│   │   ├── mcp-servers.json
│   │   ├── namespaces.json
│   │   ├── endpoints.json
│   │   ├── api-keys.json
│   │   ├── settings.json
│   │   ├── search.json
│   │   ├── inspector.json
│   │   └── logs.json
│   └── zh/                       # Chinese translations
│       └── (auto-generated)
├── lib/
│   └── i18n.ts                  # Client-side i18n utilities
├── hooks/
│   ├── useLocale.ts             # Hook to get current locale
│   └── useTranslations.ts       # Hook for client-side translations
├── components/
│   └── language-switcher.tsx    # Language switching component
└── middleware.ts                # Locale detection and routing
```

## Usage

### Client Components

For client components, use the `useTranslations` hook:

```tsx
"use client";

import { useTranslations } from "@/hooks/useTranslations";

function ClientComponent() {
  const { t, isLoading, locale } = useTranslations();
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <div>
      <h1>{t('common:title')}</h1>
      <button>{t('auth:signIn')}</button>
    </div>
  );
}
```

### Using Parameters

```tsx
// In translation file: "welcome": "Welcome, {{name}}!"
<span>{t('welcome', { name: 'John' })}</span>
```

## Routing

The application uses Next.js's App Router with locale segments:

### URL Structure

- English: `/mcp-servers`, `/settings`
- Chinese: `/zh/mcp-servers`, `/zh/settings`

### Middleware

The middleware in `middleware.ts` handles:
- Locale detection from URL, cookies, and Accept-Language header
- Automatic redirects to appropriate locale
- Authentication checks

### Navigation

Use the `getLocalizedPath` utility for navigation:

```tsx
import { getLocalizedPath } from "@/lib/i18n";

const localizedPath = getLocalizedPath("/mcp-servers", "zh");
// Returns: "/zh/mcp-servers"
```

## Adding New Translations

1. **Add to English files first** in `public/locales/en/`
2. **Add other languages** in new locale

## Translation Keys

### Key Format

Use colon-separated namespaces:

```json
{
  "server": {
    "create": "Create Server",
    "edit": "Edit Server",
    "status": {
      "online": "Online",
      "offline": "Offline"
    }
  }
}
```

Usage: `t('mcp-servers:server.create')`

### Namespace Organization

- **common**: Shared UI elements (buttons, labels, etc.)
- **auth**: Authentication-related text
- **navigation**: Menu items, navigation text
- **[feature]**: Feature-specific translations

## Language Switching

The `LanguageSwitcher` component provides a dropdown to switch between languages:

```tsx
import { LanguageSwitcher } from "@/components/language-switcher";

function Header() {
  return (
    <header>
      <LanguageSwitcher />
    </header>
  );
}
```

## Best Practices

### 1. Translation Keys

- Use descriptive, hierarchical keys
- Use camelCase for consistency
- Group related translations together

### 2. Interpolation

- Use interpolation for dynamic content
- Keep variable names descriptive

```json
{
  "welcome": "Welcome, {{userName}}!",
  "itemCount": "{{count}} items found"
}
```

### 3. Fallbacks

- Other language translations automatically fall back to English if missing
- Keys are returned as-is if no translation is found

## Troubleshooting

### Common Issues

1. **Missing translations**: Check browser console for missing key warnings
2. **Hydration errors**: Ensure consistent rendering between server and client
3. **Locale not detected**: Check middleware configuration and URL structure


## Contributing

When adding new features:

1. Add English translations first
2. Add other languages (you can use agent like Cursor to generate other files for other locale)
3. Test both locales thoroughly
4. Update this documentation if adding new patterns 