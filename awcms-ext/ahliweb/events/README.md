# Events Extension

Reference AWCMS Extension Specification v1 package for tenant-scoped event management.

## Package Layout

- `extension.json` - manifest contract
- `admin/` - admin runtime entrypoints and notes
- `public/` - public module contract assets
- `edge/` - privileged edge capability notes
- `shared/` - shared schema/config placeholders
- `supabase/` - migration and policy references
- `docs/` - extension-local docs

## Notes

- The active bundled runtime lives in `awcms/src/extensions/ahliweb-events/`.
- This workspace package is the catalog/source-of-truth artifact for authoring and review.
