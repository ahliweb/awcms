---
"awcms": minor
---

Add an optional Varnish edge-cache tier with origin-pressure auto-activation (ADR-0042).

Public, tenant-scoped, content-derived GET surfaces can now be answered by a
cache in front of the application instead of re-running the same database work
for every anonymous visitor. Off by default and a genuine no-op when off.

- `src/lib/edge-cache/` — fail-closed cacheability decision, surrogate-key
  vocabulary, rolling-window pressure tracker, surface allow-list, header
  application, durable purge queue, Varnish BAN client.
- `sql/068` — `awcms_edge_cache_purges` invalidation queue (ENABLE + FORCE RLS),
  with matching `WORKER_ROLE_GRANTS` entries.
- `infra/varnish/` — default-deny VCL and a compose overlay.
- `bun run edge-cache:surfaces:check` — new registry gate in `bun run check`.
- `bun run edge-cache:purge` — scheduled invalidation worker.

Cacheability is an allow-list: an undeclared route is never cached. The
auto-activation ramp can only change how long something is cached, never whether
a private response becomes cacheable.
