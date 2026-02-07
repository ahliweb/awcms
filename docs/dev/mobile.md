> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Mobile App Development

## 1. Overview

The AWCMS mobile app (`awcms-mobile/`) is a cross-platform Flutter application.

## 2. Architecture

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for Mobile tech stack
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- **Framework**: Flutter
- **State Management**: Riverpod.
- **Backend**: Supabase (via `supabase_flutter`).

## 3. Flavors & Configuration

We use build flavors to support multiple tenants from a single codebase (if applicable) or separate project configs.

- **Dev**: Connects to local Supabase or dev environment.
- **Prod**: Connects to production.

## 4. Setup

1. Ensure Flutter SDK is installed (`flutter doctor`).
2. `cd awcms-mobile/primary`.
3. `cp .env.example .env`.
4. `flutter pub get`.
5. `flutter run`.
