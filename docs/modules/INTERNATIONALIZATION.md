> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Internationalization (i18n)

## Purpose

Describe the current internationalization model across the AWCMS admin app, public portals, and database-backed localized content surfaces.

## Current i18n Model

AWCMS currently uses a split i18n model.

Current major surfaces:

- admin runtime translations through i18next
- public locale resolution and public locale files/helpers
- database-backed localized content overlays such as `content_translations`
- template/composition localization through `template_strings`

This means “i18n” in AWCMS is not just static JSON translation files.

## Current Admin i18n Model

The admin app still uses i18next-based runtime translation.

Current important behaviors include:

- admin translation resources in `awcms/src/locales/`
- browser/local storage driven language detection
- current admin i18n setup in `awcms/src/lib/i18n.js`
- user preference persistence through the user data model where applicable

## Current Public i18n Model

Public portals use a lighter locale-resolution and locale-file model than the admin app.

Current important behaviors include:

- locale-aware public routes
- URL-driven locale resolution for public pages
- workspace-specific public locale helpers/files
- static-first rendering expectations

Current practical rule:

- public i18n should remain compatible with static-first rendering and tenant-scoped content resolution

## Current Database-Backed Localization Model

AWCMS currently uses database-backed overlays for localized content in places such as:

- `content_translations`
- `template_strings`

Current practical implications:

- module-specific content may have a base/default locale plus overlay rows
- public/admin query paths must keep localization reads aligned with tenant scope and deleted/published rules
- localization is not limited to flat JSON message catalogs

## Current Available Languages Note

Current commonly documented/admin-supported languages remain:

- English (`en`)
- Indonesian (`id`)

Do not assume this list is the only possible locale set for every tenant/workspace without checking the current implementation and settings surfaces.

## Current Admin Usage Pattern

Representative admin usage still follows the current `useTranslation()` path:

```jsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  return <h1>{t('common.loading')}</h1>;
}
```

## Current Language Preference Guidance

- user-visible language switching should continue to use the current i18n stack
- user language preference persistence belongs in the current user/settings model where implemented
- locale switching should not bypass the existing public/admin route and state conventions

## Current Translation Key Guidance

- keep key naming consistent and descriptive
- do not store secrets or sensitive data in translation resources
- use module/namespace-oriented keys when they improve maintainability

## Current Cross-Channel Guidance

Current i18n behavior differs by channel:

- admin: i18next runtime translation
- public: static-first locale-aware rendering and helper-based resolution
- database-backed content/template overlays: tenant-scoped localized content rows
- other channels such as mobile/ESP32 may have their own localized asset paths and should not be assumed to share the same runtime model as admin/public

## Current Security Notes

- do not render user-provided HTML through translations without sanitization
- keep localized database reads tenant-scoped
- keep public localized content published-only and non-deleted where applicable

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin i18n changes | `cd awcms && npm run build` |
| public i18n changes | `cd awcms-public/primary && npm run check:astro` |
| maintained docs | `cd awcms && npm run docs:check` |

## Related Docs

- [docs/dev/public.md](../dev/public.md)
- [docs/dev/admin.md](../dev/admin.md)
- [docs/modules/TEMPLATE_SYSTEM.md](./TEMPLATE_SYSTEM.md)
- [docs/dev/multi-language.md](../dev/multi-language.md)
