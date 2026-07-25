---
"awcms": minor
---

Emit edge-cache invalidation from `theming`, and enforce the obligation by
surface ownership.

`theming` owns the `theming-tokens` surface (`/theming/{tenantCode}/tokens.css`),
so publish, rollback, and retire each change what a cached object contains.
All three now call `enqueueModuleContentPurge` inside the same transaction as
the change (ADR-0042 §9 / ADR-0006).

**`news_portal` and `media_library` deliberately do not.** Neither owns a
declared surface, so nothing cached is tagged `m:news_portal` or
`m:media_library` — a ban for those keys matches no object while the queue
records `sent=1`. Adding them now would be ceremony that reads as coverage and
provides none.

`bun run edge-cache:surfaces:check` now demands a purge call site from **every
module that owns a declared surface**, resolving `*_MODULE_KEY` constants across
files. Framing it by ownership rather than by a hand-kept module list means the
obligation appears on its own the day `news_portal` or `media_library` declares
a surface, and stays silent until then.

The asymmetry this closes: declaring a surface is one line and takes effect
immediately; wiring its invalidation is a separate edit in another file that
nothing forced. Miss it and the surface caches correctly, serves correctly, and
never updates — with no error anywhere.
