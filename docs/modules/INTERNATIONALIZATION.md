# Internationalization (i18n)

## Purpose

Describe how AWCMS handles translations and locale detection for multi-language support.

## Audience

- Admin panel developers
- Frontend developers
- Extension authors

## Prerequisites

- `docs/architecture/folder-structure.md`

---

## Available Languages

| Language   | Code | Status                |
| :--------- | :--- | :-------------------- |
| English    | `en` | **Primary** (Default) |
| Indonesian | `id` | Secondary             |

---

## Core Concepts

- **Admin**: i18next provides runtime translation.
- **Public**: `awcms-public/primary/src/utils/i18n.ts` provides lightweight locale resolution.
- Translation files live in `awcms/src/locales/` (admin) and `awcms-public/primary/src/locales/` (public).
- Admin language detection uses browser settings, with localStorage override.
- User preferences are persisted to the `users.language` database column.

---

## Configuration

### File: `awcms/src/lib/i18n.js`

```javascript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from '@/locales/en.json';
import id from '@/locales/id.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      id: { translation: id }
    },
    fallbackLng: 'en', // Default to English
    interpolation: {
      escapeValue: false // React already safes from XSS
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage']
    }
  });

export default i18n;
```

### Detection Order

1. **localStorage**: Checks for `i18nextLng` key.
2. **navigator**: Falls back to browser language settings.
3. **fallbackLng**: Uses English if no match found.

**Context7 note**: i18next recommends supporting querystring/cookie detection when needed (`querystring`, `cookie`, `localStorage`, `navigator`). AWCMS keeps admin detection minimal to avoid extra state.

---

## Usage in Components

### Using the `useTranslation` Hook

```jsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t('common.welcome_back')}</h1>
      <p>{t('common.loading')}</p>
    </div>
  );
}
```

### Changing Language Programmatically

```jsx
import { useTranslation } from 'react-i18next';

function LanguageSwitcher() {
  const { i18n } = useTranslation();
  
  const handleChange = (lang) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('i18nextLng', lang);
  };

  return (
    <button onClick={() => handleChange('id')}>Switch to Indonesian</button>
  );
}
```

### Reference Implementations

For complex examples involving dynamic column headers, form labels, and tab translations, refer to:

- **`BlogsManager.jsx`**: Demonstrates full i18n for a content module with categories and tags.
- **`ProductsManager.jsx`**: Demonstrates i18n for commerce products with tabs and status options.
- **`GenericContentManager.jsx`**: Demonstrates shared i18n patterns for search, deletion, and common actions.

---

## Translation File Structure

### File: `awcms/src/locales/en.json`

```json
{
  "common": {
    "loading": "Loading...",
    "save": "Save",
    "cancel": "Cancel"
  },
  "menu": {
    "dashboard": "Dashboard",
    "blogs": "Blogs"
  }
}
```

### Key Naming Conventions

| Pattern | Example | Use Case |
| :------ | :------ | :------- |
| `{namespace}.{key}` | `common.loading` | Shared UI elements |
| `{module}.form.{field}` | `blogs.form.excerpt` | Form labels for module-specific fields |

---

## Adding New Translations

### Step 1: Add to English File

Edit `awcms/src/locales/en.json`:

```json
{
  "my_module": {
    "welcome": "Welcome to My Module"
  }
}
```

### Step 2: Add to Indonesian File

Edit `awcms/src/locales/id.json`:

```json
{
  "my_module": {
    "welcome": "Selamat Datang di Modul Saya"
  }
}
```

### Step 3: Use in Component

```jsx
const { t } = useTranslation();
return <h1>{t('my_module.welcome')}</h1>;
```

---

## Database Persistence

User language preferences are stored in the `users` table:

| Column | Type | Description |
| :----- | :--- | :---------- |
| `language` | `text` | ISO language code (`en`, `id`) |

When a user changes their language in `LanguageSettings`, it is saved to the database and will persist across sessions and devices.

---

## UI Components

| Component | Path | Purpose |
| :-------- | :--- | :------ |
| `LanguageSelector` | `awcms/src/components/ui/LanguageSelector.jsx` | Dropdown in header |
| `LanguageSettings` | `awcms/src/components/dashboard/LanguageSettings.jsx` | Full settings page |

---

## Security and Compliance Notes

- Do not render user-provided HTML without sanitization.
- Translation keys should not contain sensitive data.
- Localization data is tenant-scoped when stored in the database.

---

## References

- [i18next Documentation](https://www.i18next.com/)
- [react-i18next Documentation](https://react.i18next.com/)
- `awcms/src/lib/i18n.js`
- `awcms/src/locales/en.json`
- `awcms/src/locales/id.json`
- `awcms-public/primary/src/utils/i18n.ts`

### Public Portal Namespaces (awcms-public)

The public portal uses the following namespaces in `src/locales/` and resolves locale via `awcms-public/primary/src/utils/i18n.ts`.

Locale resolution order (public):

1. URL path prefix (`/id` or `/en`).
2. `lang` query parameter.
3. Default to `en`.

| Namespace | Usage |
| :--- | :--- |
| `common` | General UI elements (buttons, labels) |
| `nav`, `footer` | Navigation and footer links |
| `hero` | Landing page hero section |
| `about` | About page content |
| `services_page` | Services page content |
| `pricing_page` | Pricing page content |
| `contact_page` | Contact page content |
| `blog_page` | Blog listing and categories |
| `blog_post` | Single blog post specific labels |
| `error_page` | 404 and other error messages |
| `homes` | For landing page content (startup, saas, mobile-app, personal). |
| `landing` | For landing page demos (click-through, lead-generation, pre-launch, product, sales, subscription). |

---

## Cross-Channel i18n

For multi-language implementation across all AWCMS channels, see:

- `docs/dev/multi-language.md`

### Other Channels

| Channel | Technology | Locale Path |
| :------ | :--------- | :---------- |
| awcms-public | Astro | `src/locales/` |
| awcms-mobile | Flutter | `lib/l10n/` |
| awcms-esp32 | C++ | `include/lang_*.h` |
