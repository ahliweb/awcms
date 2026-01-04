# Tech Stack & Dependencies

## Overview

AWCMS employs a "Headless" architecture with two distinct frontends sharing a common Supabase backend.

---

## 1. Admin Panel (Core)

*The internal dashboard for content and tenant management.*

| Category | Technology | Version | Purpose |
| ---------- | ------------ | --------- | --------- |
| **Framework** | [React](https://react.dev/) | **18.3.1** | UI Framework (Strict locked for Puck) |
| **Build Tool** | [Vite](https://vitejs.dev/) | 7.2.7 | SPA Bundler |
| **Language** | JavaScript | ES2022+ | Functional Components |
| **Visual Editor** | [@measured/puck](https://puckeditor.com/) | 0.20.x | Drag-and-drop Page Builder |
| **Rich Text** | [TipTap](https://tiptap.dev/) | 3.13.0 | Headless WYSIWYG |

> [!IMPORTANT]
> **Do NOT upgrade React in the Admin Panel**. The Puck editor requires React 18.

---

## 2. Public Portal (Headless Frontend)

*The multi-tenant, high-performance public website.*

| Category | Technology | Version | Purpose |
| ---------- | ------------ | --------- | --------- |
| **Meta-Framework** | [Astro](https://astro.build/) | **5.x** | Islands Architecture, SSG/SSR |
| **UI Library** | [React](https://react.dev/) | **19.x** | Component Rendering (Islands) |
| **Deployment** | [Cloudflare Pages](https://pages.cloudflare.com/) | - | Edge Hosting |
| **Validation** | [Zod](https://zod.dev/) | 3.x | Runtime Prop Validation |
| **Styling** | TailwindCSS | 4.x | Utility CSS |

> **Note**: The Public Portal uses a custom `PuckRenderer` and does not depend on the `@measured/puck` package, allowing it to use React 19.

---

## 3. Backend & Data (Shared)

| Technology | Version | Purpose |
| ------------ | --------- | --------- |
| [Supabase](https://supabase.com/) | 2.87.1 | Backend-as-a-Service |
| **PostgreSQL** | 15+ | Primary Database |
| **Auth** | GoTrue | Authentication (JWT) |
| **Storage** | S3-compatible | Media Assets |
| **Edge Functions** | Deno | Server-side Logic (User Mgmt) |

---

## 4. Key Libraries

| Category | Library | Version | Usage |
| -------- | ------- | ------- | ----- |
| **UI Primitives** | [Radix UI](https://radix-ui.com/) | Latest | Admin Panel UI |
| **Icons** | [Lucide React](https://lucide.dev/) | 0.56x | System Icons |
| **Animations** | [Framer Motion](https://www.framer.com/motion/) | 12.x | UI Transitions |
| **Maps** | Leaflet / React-Leaflet | 1.9.4 | Map Widgets |
| **Charts** | Recharts | 3.5.1 | Analytics Dashboards |
| **i18n** | i18next | 25.x | Internationalization |

---

## 5. Development Tools

| Tool | Purpose |
| ------ | --------- |
| **Node.js** | Runtime (v20+ required) |
| **npm** | Package Manager |
| **ESLint** | Code Linting |
| **Prettier** | Code Formatting |
| **Vitest** | Unit/Integration Testing |
| **Wrangler** | Cloudflare Workers CLI |
| **PostCSS** | CSS Processing |

## 6. Security Status

- **Vulnerabilities**: 0 (Regularly audited via `npm audit`)
- **Compliance**: Dependencies selected for ISO 27001 readiness.
