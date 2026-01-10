# AWCMS - Ahliweb Content Management System

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](docs/LICENSE.md)
[![React](https://img.shields.io/badge/React-18.3.1-61dafb.svg)](https://react.dev)
[![Supabase](https://img.shields.io/badge/Supabase-2.87.1-3ECF8E.svg)](https://supabase.com)
[![Node](https://img.shields.io/badge/Node.js-20+-339933.svg)](https://nodejs.org)
![Security](https://img.shields.io/badge/Vulnerabilities-0-brightgreen.svg)

A modern, enterprise-grade Content Management System built with React, TailwindCSS, and Supabase. Designed for website development and enterprise applications with comprehensive ABAC, multi-language support, and modular architecture.

---

## 📖 System Overview

AWCMS is a **Multi-Tenant** Content Management System designed for SaaS scalability. It features a "Database-First" architecture where the schema drives functionality.

### Core Architecture

1. **Multi-Tenancy**: Single instance serves multiple tenants (SaaS). Tenants are resolved via domain/subdomain.
2. **Platform Admin**: **Owner** role manages all tenants and global settings.
3. **Tenant Admin**: Manages their specific isolated content and users.
4. **Public Portal**: Branding-aware public interface for each tenant.

### Key Interfaces

1. **Admin Panel (`/cmspanel`)**: React 18 SPA. Feature-rich dashboard for content management, system configuration, and analytics.
2. **Public Portal (`/`)**: Astro 5 + React 18.3.1. High-performance, multi-tenant frontend on Cloudflare Pages.

### Core Capabilities

| Feature | Description |
| ------- | ----------- |
| **Authentication** | Integrated Supabase Auth with Email/Password, Magic Link, and OAuth providers |
| **Authorization** | Granular ABAC system with customizable Policies and Roles |
| **Data Integrity** | Implements "Soft Delete" across all major modules |
| **Performance** | Optimized with Vite 7, React 18, and search debouncing |
| **Localization** | Built-in i18n support for English (en) and Indonesian (id) |
| **Multi-Tenancy** | Domain/Subdomain resolution (`tenant1.awcms.com`, `custom.com`) using `public.tenants` |
| **Isolation** | **Strict RLS Enforcement**: Every table requires `tenant_id` and RLS enabled |
| **Subscription** | Tier-based feature access (Free, Pro, Enterprise) via `tierFeatures.js` logic |
| **Theming** | Dynamic white-labeling (Colors, Fonts, Logo) per tenant via `tenants.config` |
| **Security** | TipTap editor (XSS-safe), Supabase RLS, and zero npm vulnerabilities |
| **Performance** | Local Storage Caching (60s TTL), Vite 7, and React 18 |

### Quick Start

### Prerequisites

- **Node.js**: 20.x or higher (18.x compatible)
- **npm**: 10.x or higher

### Installation

```bash
# Clone repository
git clone https://github.com/ahliweb/awcms.git
cd awcms

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# Start development server
npm run dev
```

**Server runs at:** <http://localhost:3000>

### Build for Production

```bash
npm run build
npm run preview
```

---

## 🔐 Environment Setup

```bash
cp .env.example .env.local
```

Required variables in `.env.local`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

> ⚠️ **Never commit `.env.local` to version control!**

---

## 🛠️ Tech Stack

| Category | Technology |
| -------- | ---------- |
| Frontend (Admin) | React 18.3.1, Vite 7.2.7 |
| Frontend (Public) | Astro 5.x, React 19.x, Cloudflare Pages |
| Styling | TailwindCSS 4.1.18, Radix UI |
| Backend | Supabase (PostgreSQL, Auth, Storage) |
| Editor | TipTap 3.13.0, Puck (@measured/puck) |
| Animation | Framer Motion 12.23.26 |
| i18n | i18next 25.7.2 (EN, ID) |
| Charts | Recharts 3.5.1, Leaflet 1.9.4 |

> [!IMPORTANT]
> **React 18 Required**: This project strictly uses React 18.3.1 because the Puck visual editor is not yet compatible with React 19. Do not upgrade to React 19 until Puck adds support.

---

## ✨ Features

### 🔍 Advanced Search System

- **Global Search Implementation**: Centralized search logic using custom `useSearch` hook
- **Smart Validation**: Minimum character enforcement (3 chars for Admin, 5 chars for Public)
- **Real-time Feedback**: Loading states, character counters, and "no results" handling
- **Module Specific**: Tailored search context for Articles, Products, Users, and more

### 📝 Rich Text Editor

- **TipTap Integration**: Modern, XSS-safe WYSIWYG editor
- **Features**: Headings, Bold, Italic, Underline, Lists, Blockquotes, Links, Images
- **Secure**: Built-in sanitization prevents XSS attacks
- **Extensible**: Easy to add custom extensions

### 📑 Sidebar & Menu Management

- **Dynamic Grouping**: Organize menu items into logical groups
- **Sidebar Manager**: Drag-and-drop interface to reorder menus
- **Collapsible Sections**: Accordion-style menu groups
- **Searchable Navigation**: Quick find using sidebar search

### 🛡️ ABAC System (Attribute-Based Access Control)

📌 *Semua permission hanya berlaku dalam tenant masing-masing*

### Matriks Hak Akses - Tenant Content

| Role | C | R | U | P | SD | RS | DP | Description |
| :--- | :--: | :--: | :--: | :--: | :--: | :--: | :--: | :--- |
| **Owner (Global)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Supreme authority (Global) |
| **Super Admin (Global)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Platform management (Global) |
| **Admin (Tenant)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Tenant management (Tenant) |
| **Editor (Tenant)** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | Content review & approval |
| **Author (Tenant)** | ✅ | ✅ | ✅* | ❌ | ❌ | ❌ | ❌ | Content creation & update own |
| **Member** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | Commenting & Profile management |
| **Subscriber** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | Premium content access |
| **Public** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | Read-only access |
| **No Access** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Banned/Disabled |

*\* Author → hanya konten milik sendiri (tenant_id + owner_id)*

**Legend:**

- **C**: Create
- **R**: Read
- **U**: Update
- **P**: Publish
- **SD**: Soft Delete
- **RS**: Restore
- **DP**: Delete Permanent

### 🛡️ ABAC Policy Engine (ERP Standard)

- **JSON Policies**: Define complex access rules using JSON configuration.
- **Context Aware**: Restriction based on Channel (Web/Mobile), Time, and IP.
- **Hybrid Model**: Combines standard Roles with fine-grained Policies.
- **Multi-Device Security**: Enforces `Web-Only` for governance/publishing, `Mobile` for data entry.

### 📋 Audit Trail & Compliance

- **Immutable Logging**: Track `who`, `what`, `where`, and `when` for every critical action.
- **Diff Tracking**: Visual comparison of `old_value` vs `new_value` for data changes.
- **Channel Detection**: Identify if actions originated from Web, Mobile App, or API.

### 🔄 Workflow Engine

- **State Machine**: Enforce lifecycle states: `Draft` -> `Reviewed` -> `Approved` -> `Published`.
- **Assignment**: Assign content to specific users for approval.

### 📦 Modules

#### Content Modules

- **Articles**: Blog and News management with TipTap editor, tags, and SEO meta.
- **Pages**: Static page management with custom layouts and hierarchy.
- **Products**: E-commerce catalog with pricing, stock, SKU, and variations.
- **Portfolio**: Project showcases with client details and galleries.
- **Testimonials**: Customer testimonials and reviews management.
- **Galleries**: Photo & Video collections with playlists.

#### Marketing & CRM Modules

- **Contacts CRM**: Customer relationship management and lead tracking.
- **Announcements**: System-wide alerts with priority levels and scheduling.
- **Promotions**: Sales and discounts with codes and validity periods.

#### Mobile & IoT Modules

- **Mobile App**: User management (`mobile_users`), push notifications, and app configuration.
- **IoT Devices**: IoT device management and real-time monitoring.

#### System Modules

- **Users**: User management with role assignment and activity logs.
- **Roles**: Access control definitions with custom roles and permissions.
- **Audit Logs**: Enterprise-grade system activity tracking.
- **Policy Manager**: JSON-based access policy configuration.
- **Sidebar Manager**: Navigation configuration and menu ordering.
- **Files**: Asset management with media library and categorization.
- **Tags/Categories**: Global taxonomy management.

---

## 📁 Project Structure

```text
awcms/
├── awcms/              # Admin Panel (React 18 + Vite)
│   ├── src/
│   ├── docs/           # Core Documentation
│   └── ...
├── awcms-public/       # Public Portal Root
│   ├── primary/        # Astro Application Source
│   │   ├── src/
│   │   └── package.json
│   └── package.json    # Cloudflare Build Proxy
├── awcms-mobile/       # Mobile App Root
│   └── primary/        # Flutter Application Source
│       ├── lib/
│       └── pubspec.yaml
└── ...

```

---

## 📚 Documentation

| Document | Description |
| -------- | ----------- |
| [Installation](docs/01-guides/INSTALLATION.md) | Setup guide |
| [Configuration](docs/01-guides/CONFIGURATION.md) | Settings & env vars |
| [Architecture](docs/00-core/ARCHITECTURE.md) | System design |
| [Database Schema](docs/02-reference/DATABASE_SCHEMA.md) | Data model |
| [API Documentation](docs/02-reference/API_DOCUMENTATION.md) | Supabase API usage |
| [ABAC System](docs/03-features/ABAC_SYSTEM.md) | Permissions & Policies |
| [Multi-Tenancy](docs/00-core/MULTI_TENANCY.md) | SaaS tenant isolation |
| [Extensions](docs/03-features/EXTENSIONS.md) | Plugin & Extension system |
| [Component Guide](docs/03-features/COMPONENT_GUIDE.md) | UI components |
| [Folder Structure](docs/02-reference/FOLDER_STRUCTURE.md) | Project organization |
| [Security](docs/00-core/SECURITY.md) | Security measures |
| [Deployment](docs/01-guides/DEPLOYMENT.md) | Deploy to production |
| [AI Agents](docs/02-reference/AGENTS.md) | Agent development guide |
| [Contributing](docs/01-guides/CONTRIBUTING.md) | How to contribute |

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](docs/01-guides/CONTRIBUTING.md) for guidelines.

---

## 📄 License

MIT License - see [LICENSE.md](docs/LICENSE.md)

---

## Built with ❤️ by AhliWeb.com Team
