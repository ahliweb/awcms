# AWCMS Mobile

[![Flutter](https://img.shields.io/badge/Flutter-3.x-02569B.svg)](https://flutter.dev)
[![Supabase](https://img.shields.io/badge/Supabase-2.8.0-3ECF8E.svg)](https://supabase.com)
[![Riverpod](https://img.shields.io/badge/Riverpod-2.6.1-00D09E.svg)](https://riverpod.dev)
[![Drift](https://img.shields.io/badge/Drift-2.30-blue.svg)](https://drift.simonbinder.eu/)

Aplikasi mobile Flutter untuk **AWCMS** (Ahliweb Content Management System). Menggunakan backend Supabase yang sama dengan web admin.

---

## 🚀 Quick Start

### Prerequisites

- **Flutter SDK**: 3.10 atau lebih baru
- **Dart SDK**: 3.0 atau lebih baru
- **Supabase Project**: URL dan Anon Key dari project AWCMS

### Installation

```bash
cd awcms-mobile
flutter pub get
dart run build_runner build  # Generate Drift code
cp .env.example .env         # Configure credentials
flutter run
```

---

## 📁 Project Structure

```text
lib/
├── main.dart                    # Entry point
├── core/
│   ├── config/                  # App & Supabase config
│   ├── database/                # Drift local database
│   │   ├── tables/              # LocalArticles, SyncQueue
│   │   └── daos/                # ArticlesDao, SyncDao
│   ├── services/                # Auth, Sync, Connectivity
│   └── constants/               # App constants
├── features/
│   ├── auth/                    # Login screen
│   ├── articles/                # Articles list & detail
│   └── home/                    # Home screen
├── shared/
│   ├── widgets/                 # OfflineIndicator, etc.
│   └── themes/                  # Material 3 themes
└── routes/                      # GoRouter config

---

## 📂 Tenant Folders

Tenant-specific configuration lives under `/{tenant_code}/`:

```text
awcms-mobile/
  primary/               # Default tenant
    README.md            # Tenant config docs
  lib/                   # Shared Flutter code
```

See the [parent README](../README.md) for multi-tenant folder structure.

---

## 🛠️ Tech Stack

| Category | Technology |
| -------- | ---------- |
| Framework | Flutter 3.x |
| State Management | Riverpod 2.x |
| Routing | GoRouter 14.x |
| Backend | Supabase Flutter 2.x |
| Local Database | Drift 2.30 (SQLite) |
| Connectivity | connectivity_plus |
| UI | Material 3, Shimmer, CachedNetworkImage |

---

## 📱 Features

### ✅ Implemented

- **Authentication**: Email/Password login via Supabase Auth
- **Articles**: List & detail dari CMS
- **Multi-Tenant**: Tenant context support
- **Dark Mode**: Tema otomatis mengikuti sistem
- **Offline-First**: Data cached di local SQLite

### 📴 Offline Mode

Aplikasi mendukung **offline-first** dengan ketentuan:

| Feature | Offline | Notes |
| :------ | :------ | :---- |
| Baca artikel | ✅ | Dari cache lokal |
| Lihat gambar cached | ✅ | CachedNetworkImage |
| Upload gambar | ❌ | Perlu koneksi |
| Download file | ❌ | Perlu koneksi |
| Lihat PDF | ❌ | Perlu koneksi |
| Akses Storage | ❌ | Perlu koneksi |

> ⚠️ **Warning**: Saat offline, fitur file/asset (upload, download, PDF viewer) tidak tersedia dan akan menampilkan warning.

---

## 🔗 Integration with AWCMS

Menggunakan **backend yang sama** dengan web admin:

- **Database**: PostgreSQL via Supabase
- **Auth**: Supabase Auth (akun sama dengan web)
- **RLS**: Row Level Security untuk tenant isolation
- **Realtime**: Subscribe ke perubahan data
- **Storage**: Supabase Storage (online only)

---

## 📚 Documentation

| Document | Description |
| -------- | ----------- |
| [Mobile Development](../../awcms/docs/01-guides/MOBILE_DEVELOPMENT.md) | Strategi pengembangan mobile |
| [API Documentation](../../awcms/docs/02-reference/API_DOCUMENTATION.md) | Supabase API usage |
| [ABAC System](../../awcms/docs/03-features/ABAC_SYSTEM.md) | Permissions & Policies |

---

## 🏗️ Build for Production

```bash
# Android APK
flutter build apk --release

# Android App Bundle
flutter build appbundle --release

# iOS (requires macOS)
flutter build ios --release
```

---

## 📄 License

MIT License - see [LICENSE](../../LICENSE)

---

Built with ❤️ by AhliWeb.com Team
