> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack) and Section 2.4 (Internationalization)

# Multi-Language Development Guide

This guide covers internationalization (i18n) across all AWCMS channels.

## Supported Languages

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for i18n implementation patterns
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references

| Code | Language | Status |
| :--- | :------- | :----- |
| `en` | English | **Primary** (Default) |
| `id` | Indonesian | Secondary |

---

## Channel-Specific Implementation

### awcms (Admin Panel)

**Technology:** React + i18next

**Location:** `awcms/src/locales/`

**Usage:**

```jsx
import { useTranslation } from 'react-i18next';

function Component() {
  const { t } = useTranslation();
  return <h1>{t('common.loading')}</h1>;
}
```

**Key Files:**

- `awcms/src/lib/i18n.js`
- `awcms/src/locales/en.json`
- `awcms/src/locales/id.json`

---

### awcms-public (Public Portal)

**Technology:** Astro + TypeScript utility

**Location:** `awcms-public/primary/src/locales/`

**Usage:**

```astro
---
import { t, getLocale } from '../utils/i18n';
const locale = getLocale(Astro.request);
---
<h1>{t('nav.home', locale)}</h1>
```

**Key Files:**

- `awcms-public/primary/src/utils/i18n.ts`
- `awcms-public/primary/src/locales/en.json`
- `awcms-public/primary/src/locales/id.json`
- `awcms-public/primary/src/components/common/LanguageSwitcher.astro`

**Language Switcher:**

The public portal includes a language switcher dropdown in the header:

- Displays current language code (EN/ID)
- Dropdown with flag icons for each language
- Uses URL parameter `?lang=en` or `?lang=id`
- Path prefix (`/en` or `/id`) takes priority when present

**Tenant note:** `awcms-public/smandapbun` defaults to `id` and relies on path prefixes only.

---

### awcms-mobile (Flutter App)

**Technology:** Flutter + intl

**Location:** `awcms-mobile/primary/lib/l10n/`

**Usage:**

```dart
import 'package:flutter_gen/gen_l10n/app_localizations.dart';

Text(AppLocalizations.of(context)!.loading)
```

**Setup in main.dart:**

```dart
MaterialApp(
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
);
```

**Key Files:**

- `awcms-mobile/primary/l10n.yaml`
- `awcms-mobile/primary/lib/l10n/app_en.arb`
- `awcms-mobile/primary/lib/l10n/app_id.arb`

---

### awcms-esp32 (IoT Firmware)

**Technology:** C++ (Arduino)

**Location:** `awcms-esp32/primary/include/`

**Usage:**

```cpp
#include "config.h"  // Includes the correct language file

Serial.println(STR_DEVICE_READY);
```

**Change Language:**
Edit `config.h`:

```cpp
#define DEVICE_LANGUAGE "id"  // Change from "en" to "id"
```

**Key Files:**

- `awcms-esp32/primary/include/config.h`
- `awcms-esp32/primary/include/lang_en.h`
- `awcms-esp32/primary/include/lang_id.h`

---

## Adding New Translations

### Step 1: Add English Key

Add the key to the English locale file first.

### Step 2: Add Indonesian Translation

Add the same key with Indonesian translation.

### Step 3: Use in Code

Reference the key in your component/code.

---

## Key Naming Conventions

| Pattern | Example | Use Case |
| :------ | :------ | :------- |
| `{namespace}.{key}` | `common.loading` | Shared strings |
| `{module}.{action}` | `auth.login` | Module-specific actions |
| `{module}.form.{field}` | `contact.form.name` | Form labels |

---

## Testing Translations

1. **Admin Panel**: Clear localStorage, reload
2. **Public Portal**: Add `?lang=id` to URL
3. **Mobile**: Change device language settings
4. **ESP32**: Recompile with different `DEVICE_LANGUAGE`

---

## Best Practices

- **Avoid Hardcoding**: Never write user-visible text directly in JSX/HTML. Always use `t()`.
- **Use Placeholders**: For dynamic text, use interpolation: `t('welcome_user', { name: userName })`.
- **Group Keys**: Organize keys logically by module or component to prevent conflicts.
- **Fallbacks**: Always provide a fallback key or value if translation is missing (handled by i18next).
