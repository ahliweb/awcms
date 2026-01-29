# AWCMS Mobile

Aplikasi mobile Flutter untuk AWCMS.

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

## Environment Variables

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

## Key Concepts

- Menggunakan Supabase yang sama dengan admin.
- Tenant context disimpan lokal dan dipakai sebagai filter query.
- Offline cache menggunakan Drift.

## References

- `../../DOCS_INDEX.md`
- `../../docs/dev/mobile.md`
