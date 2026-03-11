# AWCMS Public Portal (Smanda Pangkalan Bun)

Tenant-specific public portal package for SMAN 2 Pangkalan Bun, built with Astro 5 and React islands.

## Stack

- Astro 5.17.1
- React 19.2.4
- Tailwind CSS 4.1.18
- Supabase JS 2.93.3
- Node.js >= 22.12.0

## Quick Start

```bash
cd awcms-public/smandapbun
npm install
cp .env.example .env
npm run dev
```

## Environment Variables

Required keys are defined in `.env.example`:

```env
PUBLIC_SUPABASE_URL=...
PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
PUBLIC_TURNSTILE_SITE_KEY=...
PUBLIC_TENANT_ID=...
```

Optional tenant slug override:

```env
PUBLIC_TENANT_SLUG=smandapbun
```

For automatic public rebuilds after Admin content changes, configure these non-public tenant settings:

- `public_rebuild_webhook_url=<Cloudflare Pages deploy hook URL>`
- `public_rebuild_webhook_secret=` (optional; only needed for the DB-trigger -> Worker webhook variant)

The maintained live setup uses the Cloudflare Pages deploy hook directly, while the Admin panel also triggers
`awcms-edge` `/api/public/rebuild` after page/blog/menu updates.

Tenant-managed files continue to use the shared Cloudflare R2 bucket `awcms-s3` with tenant-prefixed keys.

Optional storage keys:

```env
PUBLIC_SUPABASE_S3_ENDPOINT=...
PUBLIC_SUPABASE_S3_REGION=...
PUBLIC_SUPABASE_S3_BUCKET=...
```

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start local Astro dev server |
| `npm run build` | Build static output |
| `npm run deploy:pages` | Direct-upload `dist/` to Cloudflare Pages |
| `npm run preview` | Preview built output |

## References

- `../README.md`
- `../../docs/dev/public.md`
- `../../docs/tenancy/supabase.md`
- `../../docs/modules/PUBLIC_PORTAL_ARCHITECTURE.md`
