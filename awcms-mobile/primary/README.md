# AWCMS Mobile (Primary)

Primary Flutter client for AWCMS end users.

## Prerequisites

- Flutter SDK 3.38.5+
- Dart SDK 3+

## Quick Start

```bash
cd awcms-mobile/primary
flutter pub get
cp .env.example .env
flutter run
```

## Common Commands

- `flutter pub get` - install dependencies
- `flutter analyze` - run static analysis
- `flutter test` - run test suite
- `flutter run` - launch on a device or emulator

## Environment Variables

```env
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
DEFAULT_TENANT_ID=...
```

## Key Concepts

- Uses the same Supabase project as the admin and public clients.
- Stores tenant context locally and applies it as a query filter.
- Uses Drift for offline cache support.
- Never use `SUPABASE_SECRET_KEY` in the mobile app.

## References

- `../../DOCS_INDEX.md`
- `../../docs/dev/mobile.md`
- `../../docs/tenancy/supabase.md`
