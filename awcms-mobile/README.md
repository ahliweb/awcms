# AWCMS Mobile

## Purpose

Multi-tenant Flutter app for AWCMS.

## Prerequisites

- Flutter 3.38.5+

## Quick Start

```bash
cd awcms-mobile/primary
flutter pub get
cp .env.example .env
flutter run
```

## Notes

- This workspace entrypoint targets `awcms-mobile/primary` as the maintained Flutter app.
- Use the publishable Supabase key only; never place `SUPABASE_SECRET_KEY` in mobile env files.

## References

- `primary/README.md`
- `../DOCS_INDEX.md`
- `../docs/dev/mobile.md`
