
# Folder Structure

## Overview

AWCMS follows a standard React application structure optimized for scalability and maintainability.

---

## Root Directory

```text
awcms/
├── 📁 docs/              # Documentation (41 files)
├── 📁 public/            # Static assets
│   ├── logo.svg          # AWCMS logo
│   ├── favicon.svg       # Browser favicon
│   └── .htaccess         # Apache rewrite rules
├── 📁 src/               # Source code (main application)
├── 📁 dist/              # Production build output
├── 📄 index.html         # HTML entry point
├── 📄 package.json       # Dependencies & scripts
├── 📄 vite.config.js     # Vite configuration
├── 📄 postcss.config.js  # PostCSS configuration
├── 📄 .env.example       # Environment template
├── 📄 .env.local         # Local environment (not committed)
├── 📄 .gitignore         # Git ignore rules
├── 📄 .nvmrc             # Node version specification
└── 📄 README.md          # Project overview
```

> **Note:** TailwindCSS 4.0 no longer requires `tailwind.config.js` - configuration is done via CSS.

---

## Source Directory (`src/`)

```text
src/
├── 📁 components/
│   ├── 📁 dashboard/     # Admin panel components (49 files)
│   │   ├── AdminDashboard.jsx
│   │   ├── AdminLayout.jsx
│   │   ├── ArticleEditor.jsx
│   │   ├── ArticlesManager.jsx
│   │   ├── ExtensionsManager.jsx
│   │   ├── Header.jsx
│   │   ├── MenusManager.jsx
│   │   ├── PageEditor.jsx
│   │   ├── PagesManager.jsx
│   │   ├── PermissionMatrix.jsx
│   │   ├── RoleEditor.jsx
│   │   ├── RolesManager.jsx
│   │   ├── Sidebar.jsx
│   │   ├── SidebarMenuManager.jsx
│   │   ├── SSOManager.jsx
│   │   ├── TagsManager.jsx
│   │   ├── ThemeEditor.jsx
│   │   ├── ThemesManager.jsx
│   │   ├── TwoFactorSettings.jsx
│   │   ├── UserEditor.jsx
│   │   ├── UserProfile.jsx
│   │   ├── 📁 media/         # Media management
│   │   ├── 📁 notifications/ # Notification components
│   │   ├── 📁 widgets/       # Dashboard widgets
│   │   └── ...
│   ├── 📁 public/        # Public-facing components (9 files)
│   │   ├── PublicHeader.jsx
│   │   ├── PublicFooter.jsx
│   │   └── ...
│   └── 📁 ui/            # Reusable UI components (30 files)
│       ├── button.jsx
│       ├── input.jsx
│       ├── dialog.jsx
│       ├── select.jsx
│       ├── tabs.jsx
│       ├── toast.jsx
│       ├── RichTextEditor.jsx
│       ├── ImageUpload.jsx
│       ├── LocationPicker.jsx
│       ├── TagInput.jsx
│       └── ...
│
├── 📁 contexts/          # React Context providers
│   ├── SupabaseAuthContext.jsx
│   ├── PermissionContext.jsx
│   ├── PluginContext.jsx        # Plugin/Extension system
│   └── ThemeContext.jsx
│
├── 📁 hooks/             # Custom React hooks
│   ├── useAdminMenu.js
│   ├── useDashboardData.js
│   ├── useExtensionAudit.js     # Extension audit logging
│   ├── useMedia.js
│   ├── useNotifications.js
│   ├── useSearch.js
│   ├── useTemplates.js          # Template CRUD operations
│   ├── useTemplateStrings.js    # Localized strings with fallback
│   ├── useTwoFactor.js
│   └── useWidgets.js            # Widget CRUD operations
│
├── 📁 lib/               # Utilities and configs
│   ├── customSupabaseClient.js  # Public Supabase client
│   ├── supabaseAdmin.js         # Admin client (service role)
│   ├── utils.js                 # Helper functions (cn, etc.)
│   ├── hooks.js                 # WordPress-style hooks system
│   ├── pluginRegistry.js        # Core plugin registry
│   ├── externalExtensionLoader.js # External extension loader
│   ├── extensionRegistry.js     # Extension component registry
│   ├── templateExtensions.js    # Template/Widget/PageType APIs
│   ├── widgetRegistry.js        # Widget type definitions
│   ├── i18n.js                  # i18n configuration
│   └── themeUtils.js            # Theme utilities
│
├── 📁 locales/           # i18n translations
│   ├── en.json           # English
│   └── id.json           # Indonesian
│
├── 📁 pages/             # Page components
│   ├── Dashboard.jsx     # Main dashboard page
│   ├── LoginPage.jsx     # Authentication page
│   ├── 📁 cmspanel/      # Admin panel pages
│   └── 📁 public/        # Public site pages (19 files)
│
├── 📁 plugins/           # Core plugins (bundled)
│   ├── 📁 backup/        # Backup plugin
│   │   ├── plugin.json   # Plugin manifest
│   │   └── index.js      # Entry point
│   └── 📁 helloworld/    # Example plugin
│
├── 📁 utils/             # Additional utilities
│
├── 📄 App.jsx            # Root component
├── 📄 main.jsx           # Entry point
└── 📄 index.css          # Global styles (TailwindCSS 4)
```

> **External Extensions** are located at project root in `awcms-ext-{vendor}-{slug}/` folders. See [EXTENSIONS.md](../03-features/EXTENSIONS.md) for details.

---

## Documentation Directory (`docs/`)

```text
docs/
├── README.md             # Documentation overview
├── INSTALLATION.md       # Setup guide
├── CONFIGURATION.md      # Configuration options
├── ARCHITECTURE.md       # System architecture
├── DATABASE_SCHEMA.md    # Database tables
├── API_DOCUMENTATION.md  # API usage
├── ABAC_SYSTEM.md        # Permissions system
├── COMPONENT_GUIDE.md    # UI components
├── SECURITY.md           # Security measures
├── DEPLOYMENT_GUIDE.md   # Deployment options
├── CONTRIBUTING.md       # Contribution guide
├── TESTING.md            # Testing guide
├── TROUBLESHOOTING.md    # Common issues
├── CHANGELOG.md          # Version history
├── LICENSE.md            # MIT License
├── TECH_STACK.md         # Technologies used
├── FOLDER_STRUCTURE.md   # This file
├── AGENTS.md             # AI assistance guide
├── MENU_SYSTEM.md        # Menu configuration
├── INTERNATIONALIZATION.md # i18n guide
├── CLOUDFLARE_DEPLOYMENT.md # Cloudflare deploy guide
└── ...                   # Additional docs
```

---

## Key Files Explained

| File | Purpose |
| ---- | ------- |
| `main.jsx` | Application entry point, renders root component |
| `App.jsx` | Root component with providers and router |
| `index.css` | Global CSS with TailwindCSS 4 directives |
| `vite.config.js` | Build tool configuration with aliases |
| `postcss.config.js` | PostCSS with TailwindCSS plugin |

---

## Import Aliases

```javascript
// @ maps to /src directory
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
```

Configured in `vite.config.js`:

```javascript
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src')
  }
}
```

---

## Component Categories

### Dashboard Components (49 files)

| Category | Examples |
| -------- | -------- |
| **Content Managers** | ArticlesManager, PagesManager, ProductsManager |
| **Editors** | ArticleEditor, PageEditor, ThemeEditor, RoleEditor |
| **System** | UsersManager, RolesManager, PermissionMatrix |
| **Navigation** | Sidebar, SidebarMenuManager, MenusManager |
| **Settings** | SSOManager, TwoFactorSettings, LanguageSettings |
| **Layout** | AdminLayout, AdminDashboard, Header |

### UI Components (30 files)

| Category | Components |
| -------- | ---------- |
| **Forms** | button, input, textarea, select, checkbox, switch |
| **Feedback** | toast, alert, dialog, alert-dialog |
| **Layout** | card, tabs, scroll-area |
| **Data Display** | table, badge, avatar, skeleton, progress |
| **Custom** | RichTextEditor, ImageUpload, LocationPicker, TagInput |
