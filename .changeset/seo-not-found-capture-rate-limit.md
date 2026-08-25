---
"awcms": patch
---

fix(seo): the public 404 telemetry write had no rate limit, and two documents called its cardinality bounded when the caller supplies the key

`recordPublicNotFound` runs after ANY public request that resolves to a tenant
and 404s. It is unauthenticated, it opens its own transaction, and it performs
one `INSERT … ON CONFLICT` per request.

Its aggregation key is
`(tenant_id, normalized_path, referrer_domain, locale, domain_host)` — and the
caller controls two of those five freely. The path is whatever they request (up
to the 2048 `normalizeRedirectPath` allows), and `referrer_domain` is
`new URL(request.headers.get("referer")).hostname`, with no allow-list. So
`/a1 … /aN` is N rows, and each is multipliable again by varying `Referer`.

## The claim that made it look handled

Two documents said this was bounded, and the stronger one is load-bearing:

- `not-found-directory.ts`: *"bounded cardinality + bounded retention"*.
- `seo-distribution/module.ts`: *"cardinality is bounded by distinct 404 paths,
  not by traffic — the volume that would justify range-partitioning is already
  collapsed by the upsert"* — the stated justification for
  `partition.eligible: false`.

The upsert collapses **repeats of one key**. It does nothing about distinct
keys. And there is no fixed set of "404 paths": the set is whatever anyone
requests, so distinct keys are produced *by* traffic, which is what the
rationale denies.

The `sql/060` DDL comment, notably, is correct as written — it says *"a bot
probing the **same** 404 a million times is one row"*. The claim only became
false where it was paraphrased.

## The sibling already had the answer

`POST /api/v1/analytics/collect` is the same kind of endpoint — public,
anonymous, one row per request — and it has had a per-IP rate limit since it
shipped, for a threat its own comment states in terms that transfer word for
word: *"anyone holding a public tenantCode could flood the endpoint with
unbounded session/event writes and poison a tenant's aggregates."*

This path had no equivalent. It now uses the same `checkSharedRateLimit`
backstop at the same 120 req / 60 s default, env-tunable via
`SEO_NOT_FOUND_RATE_LIMIT_MAX` / `SEO_NOT_FOUND_RATE_LIMIT_WINDOW_SEC`.

Keyed on **IP only, never the tenant** — the beacon's no-oracle contract kept
here, so a refusal is driven purely by volume from one source and reveals
nothing about whether a tenant exists. Nothing is refused to the visitor: the
404 response has already been produced and is returned unchanged; only the
telemetry write is skipped, and skipped **silently**, because logging per
refused write would hand the same flood a second amplifier.

## What was NOT done

No per-tenant cap on distinct rows. A cap bounds storage harder, but introduces
a failure mode that does not exist today — an attacker who fills it makes real
404s invisible — and the rate limit plus the already-declared age-based purge
(30d default, 7d floor) bounds the steady state without that. The partition
rationale now says outright that raising the rate limit substantially means
re-examining `partition.eligible` rather than assuming it still holds.

The resolve path itself was audited in the same pass and is sound: `MAX_REDIRECT_HOPS = 5`
bounds the chain walker, and `awcms_seo_redirects_resolve_idx` is a partial
index on exactly `(tenant_id, normalized_source_path) WHERE deleted_at IS NULL
AND state = 'active'`. Issue #599 taking that table from near-empty to ~23,906
rules per tenant is a B-tree lookup, not a scan.

Proven without a database, on a differential the function's own fail-open
contract would otherwise hide: with `DATABASE_URL` unset the DB step logs
`seo_distribution.not_found.capture_failed`, so "within budget" logs it once and
"over budget" logs nothing at all. A test asserting only "it does not throw"
would pass either way. Removing the backstop and moving the tenant into the
limiter key each redden three cases.
