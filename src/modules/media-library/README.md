# media_library

Tenant-scoped media object registry and upload flow — a System Foundation module
reusable by every website module ([ADR-0036](../../../docs/adr/0036-media-library-module-admission-ownership-inversion.md),
adapting awcms-micro ADR-0026).

## Origin — an ownership inversion, not a fresh port

This module was created by **extracting the media registry out of `news_portal`**.
Before ADR-0036, `news_portal` owned the registry (because the epic that needed
media happened to be the news portal) and exposed it as the `news_media`
capability; a brochure-site tenant (`blog_content` + `tenant_domain`, no news
portal) therefore had no managed media at all.

The coupling lived in the port contract itself
(`NewsMediaPort.isFullOnlineR2ModeActiveForTenant` — a `news_portal` editorial
question), so the port was **split**, not just renamed. `media_library` now owns:

- the registry table `awcms_news_media_objects` (kept its name deliberately — §3
  of the ADR: a hard composite FK from `awcms_news_portal_ad_placements` plus
  three migrations reference it), migrations `041`/`042`/`045`;
- the presigned direct-to-R2 upload/finalize/cancel flow
  (`/api/v1/media/news-images/upload-sessions/*`) with real magic-byte MIME
  sniffing and server-side SHA-256 verification;
- the `news-media:reconcile` background job (command name kept);
- the `media_library` capability (`_shared/ports/media-library-port.ts`,
  `MediaLibraryPort`), consumed by `blog_content` (optional) and `news_portal`
  (required — ad placements FK a media object).

`news_portal` keeps homepage sections + ad placements (and, where ported, the
R2-only editorial preset); it now **consumes** `media_library`.

## Managed-media enforcement (ADR-0036 step 5a) — one-way by construction

"Must this tenant's media references be registry-backed?" is answered by two
halves that both must hold:

1. **Deployment readiness** — `domain/managed-media-readiness.ts`
   (`evaluateManagedMediaReadiness`), pure: R2 enabled, config complete, and
   separated from `sync-storage`'s own `R2_*` credentials. Reason-code strings
   are identical to `news-portal-preset-readiness.ts`'s (the media half was
   carved out of it, and it now composes this).
2. **Per-tenant opt-in** — `application/media-library-tenant-state.ts`
   (`awcms_media_library_tenant_state`, migration `053`, RLS FORCE). The only
   writer is `markManagedMediaEnforced`, called only from the sanctioned entry
   point `application/enable-managed-media-enforcement.ts`, exposed as
   `POST /api/v1/media/enforcement` (permission `media_library.enforcement.enable`).

**Enforcement is one-way.** There is no `disable` action, no unmark function, and
no DELETE against the state table anywhere — a tenant able to switch its own media
validation off is the exploit `sql/043`'s header records as
confirmed-exploitable. The only rollback is a deployment-level `NEWS_MEDIA_R2_*`
change (fail-closed via readiness). Guarded by
`tests/media-enforcement-one-way.test.ts`.

## Layout

```
media-library/
  module.ts                                  # descriptor: system, provides media_library, 11 permissions, reconcile job
  domain/
    media-permissions.ts                     # MEDIA_PERMISSIONS (9) + MEDIA_ENFORCEMENT_PERMISSIONS (2)
    media-r2-config.ts                        # NEWS_MEDIA_R2_* config (names kept), separation-from-sync-storage checks
    managed-media-readiness.ts               # evaluateManagedMediaReadiness (media half of preset readiness)
    media-mime-sniffer.ts | media-object-key.ts | media-finalize-decision.ts
    media-upload-session-validation.ts | media-reconciliation-categorization.ts
  application/
    media-object-directory.ts                # registry data layer (internal symbols kept: fetchNewsMediaObjectById, ...)
    media-finalize-upload-session.ts | media-r2-verification.ts | media-reconciliation.ts
    media-library-port-adapter.ts            # mediaLibraryPortAdapter (imports ONLY media_library)
    media-library-tenant-state.ts            # markManagedMediaEnforced (only writer) + isManagedMediaEnforcedForTenant
    enable-managed-media-enforcement.ts      # sanctioned enforcement-enable entry point (readiness-gated + audited)
  infrastructure/
    media-r2-client.ts
```

## Migrations

| Migration | What                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `052`     | Repoint permission ownership `news_portal.media.*` → `media_library.media.*` (INSERT → repoint role grants → DELETE; order load-bearing) |
| `053`     | `awcms_media_library_tenant_state` (RLS ENABLE+FORCE + tenant_isolation) + backfill from `awcms_news_portal_tenant_state`                |
| `054`     | `media_library.enforcement.{read,enable}` permission catalog rows                                                                        |

Registry/upload/homepage/ad-placement tables (`041`–`045`) were created before
the inversion and are unchanged.

## Not ported to this base (deferred, additive)

Media lifecycle/browser surface (`/api/v1/media/objects/*`, `/admin/media` —
micro step 5d), responsive `srcset` render (step 5b), and the PDF media type
(step 5c). The allowed MIME set stays the four raster types and the module
declares no `navigation` yet.
