# AWCMS Mobile

[![Flutter](https://img.shields.io/badge/Flutter-3.x-02569B.svg)](https://flutter.dev)
[![Supabase](https://img.shields.io/badge/Supabase-2.8.0-3ECF8E.svg)](https://supabase.com)
[![Riverpod](https://img.shields.io/badge/Riverpod-2.6.1-00D09E.svg)](https://riverpod.dev)

Aplikasi mobile Flutter untuk **AWCMS** (Ahliweb Content Management System). Menggunakan backend Supabase yang sama dengan web admin.

---

## 🚀 Quick Start

### Prerequisites

- **Flutter SDK**: 3.10 atau lebih baru
- **Dart SDK**: 3.0 atau lebih baru
- **Supabase Project**: URL dan Anon Key dari project AWCMS

### Installation

```bash
# Masuk ke folder
cd awcms-mobile

# Install dependencies
flutter pub get

# Copy environment file
cp .env.example .env
# Edit .env dengan kredensial Supabase Anda

# Jalankan aplikasi
flutter run
```

---

## 📁 Project Structure

```
lib/
├── main.dart                    # Entry point & Supabase init
├── core/
│   ├── config/                  # App & Supabase configuration
│   ├── services/                # Supabase & Auth services
│   ├── utils/                   # Tenant utilities
│   └── constants/               # App constants
├── features/
│   ├── auth/                    # Login, Register screens
│   ├── articles/                # Articles list & detail
│   └── home/                    # Home screen
├── shared/
│   ├── widgets/                 # Reusable widgets
│   └── themes/                  # App themes
└── routes/                      # GoRouter configuration
```

---

## 🔧 Configuration

Edit file `.env` dengan kredensial dari project Supabase Anda:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
APP_NAME=AWCMS Mobile
APP_ENV=development
```

> ⚠️ **Penting**: Jangan commit `.env` ke repository!

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Flutter 3.x |
| State Management | Riverpod 2.x |
| Routing | GoRouter 14.x |
| Backend | Supabase Flutter 2.x |
| UI | Material 3, Shimmer, CachedNetworkImage |

---

## 📱 Features

- ✅ **Authentication**: Email/Password login dengan Supabase Auth
- ✅ **Articles**: Daftar dan detail artikel dari CMS
- ✅ **Multi-Tenant**: Dukungan tenant context seperti web admin
- ✅ **Dark Mode**: Tema otomatis mengikuti sistem
- ✅ **Offline-Ready**: Cached images dan data

---

## 🔗 Integration with AWCMS

Aplikasi ini menggunakan **backend yang sama** dengan web admin AWCMS:

- **Database**: PostgreSQL via Supabase
- **Auth**: Supabase Auth (akun sama dengan web)
- **RLS**: Row Level Security untuk tenant isolation
- **Realtime**: Subscribe ke perubahan data

Lihat dokumentasi lengkap di [`awcms/docs/MOBILE_DEVELOPMENT.md`](../awcms/docs/MOBILE_DEVELOPMENT.md)

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Mobile Development](../awcms/docs/MOBILE_DEVELOPMENT.md) | Strategi pengembangan mobile |
| [API Documentation](../awcms/docs/API_DOCUMENTATION.md) | Supabase API usage |
| [ABAC System](../awcms/docs/ABAC_SYSTEM.md) | Permissions & Policies |

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

MIT License - see [LICENSE](../LICENSE)

---

**Built with ❤️ by AhliWeb.com Team**
