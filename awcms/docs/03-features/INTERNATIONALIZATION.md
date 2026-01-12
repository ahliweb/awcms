# Internationalization (i18n)

## Purpose
Describe how AWCMS handles translations and locale detection.

## Audience
- Admin panel developers

## Prerequisites
- `awcms/docs/02-reference/FOLDER_STRUCTURE.md`

## Core Concepts

- i18next provides runtime translation.
- Translation files live in `awcms/src/locales`.
- Template strings may be stored in `template_strings`.

## How It Works

- Configuration: `awcms/src/lib/i18n.js`.
- Language detection uses `i18next-browser-languagedetector`.

## Implementation Patterns

```javascript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// See awcms/src/lib/i18n.js for the full setup.
```

## Permissions and Access

- Localization data is tenant-scoped when stored in the database.

## Security and Compliance Notes

- Do not render user-provided HTML without sanitization.

## References

- `../03-features/TEMPLATE_SYSTEM.md`
- `../../src/lib/i18n.js`
