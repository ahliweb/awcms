🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0040-site-search-module-admission.id.md)

# ADR-0040 — Admission of `site_search` (Official Optional Module): cross-content PostgreSQL FTS via search-source descriptors, DAG-safe inward

- **Status:** Accepted
- **Date:** 2026-07-25
- **Decision maker:** @ahliweb
- **Adapts:** awcms-micro `src/modules/site-search/` + ADR-0031 (issue #270, epic #261 Wave 2; in awcms-micro the migrations are numbered 087/088 — that repo's numbering, not this one's) onto the `awcms` base. Here the schema lands in `sql/064` and the permission seed in `sql/065`.
- **Related:** ADR-0038/0039 (`seo_distribution` — the precedent for INWARD contribution: the content module is the PROVIDER, the aggregator module the CONSUMER), ADR-0037 (`data_lifecycle`, this module's two telemetry tables are registered there), ADR-0036 (`media_library` — a follow-up search source provider), ADR-0013 §1/§6 (a module does not write to another module's tables; collaboration goes through a contract declared by the owning module), ADR-0009 (tenant-scoped public routes based on `tenantCode`), ADR-0011 (capability ports), ADR-0035 (the awcms-micro absorption programme), [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) §Wave 1.

## Context

This base has **per-module** search today: `blog_content` owns `search_vector` on `awcms_blog_posts`/`awcms_blog_pages` (migration `sql/035`) plus the route `/blog/{tenantCode}/search`. What does not exist is **cross-content, single-tenant** search — one indexed surface unifying posts, pages, and whatever content types come next, complete with suggestions, rebuild, and reconciliation.

If that need is met ad hoc, every subsequent content module will grow its own version of indexing/relevance/snippets — exactly the cross-module drift ADR-0036/0038 just went to great lengths to invert for media and SEO. The decisions that must be bound **before** code: who owns the search index, which way dependencies flow, and through what seam a content module contributes a search source without cross-imports and without writing into someone else's index table.

Grounding facts that already exist and are **not** rewritten by this module:

- `blog_content` already owns a single "public + published" predicate (`status='published' AND visibility='public' AND deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= now()`) used by its own public routes **and** by its `seo_facts` adapter. `site_search` consumes that predicate through a descriptor rather than re-modelling it.
- `tenant_domain` (ADR-0010, landed via #219) resolves the tenant from the host for public routes. The public search surface uses it exactly like the `seo_distribution` discovery routes do.
- This base's public content routes are **tenant-path based** (`/blog/{tenantCode}/{slug}`, ADR-0009) — not host-resolved `/news/:slug` like awcms-micro. That is the one structural difference that reaches all the way into the descriptor shape (§7).

## Decision

We admit **`site_search`** as an **Official Optional Module** (a generic cross-domain website product feature, opt-in per tenant), using **PostgreSQL full-text search as the default** (`tsvector`/GIN; `pg_trgm` ONLY for title typeahead suggestions), and realising its collaboration through a **search-source contribution contract** — **not** cross-module internal imports and **not** direct writes into a shared table (ADR-0013 §6).

The direction of ownership is stated firmly, mirroring ADR-0038: **content modules are the PROVIDERS of "search sources"; `site_search` is the CONSUMER/aggregator.** No existing module is made to depend on `site_search`, and `site_search` takes no lifecycle dependency on any content module (only on Core) — so the graph stays DAG-safe.

### 1. Admission parameters

| Parameter                  | Value                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Name                       | Site Search                                                                                                                                |
| `key`                      | `site_search`                                                                                                                              |
| Category                   | **Official Optional Module** — site search is a generic need of **every** public site across verticals, opt-in per tenant                  |
| `type` in code             | `domain` (same as `blog_content`/`news_portal`/`seo_distribution`)                                                                         |
| `isCore`                   | no                                                                                                                                         |
| `status`                   | `active` — descriptor + runtime code land together                                                                                         |
| Lifecycle `dependencies`   | `["tenant_admin", "identity_access"]` **only** — not on `blog_content`/`news_portal`/`media_library`                                       |
| Search-source contribution | the descriptor list `ModuleDescriptor.searchSources` (§3) — **not** a `provides` capability (>1 provider = `capability_provider_conflict`) |
| Compatibility class        | Index + queries from the local DB = **offline-lan-safe**; external search services (Elastic/OpenSearch/vector) = **out of scope**          |

### 2. Dependency direction — why the arrow points INWARD (DAG-safe)

| Module          | Role with respect to `site_search`                          | Lifecycle `dependencies`              |
| --------------- | ----------------------------------------------------------- | ------------------------------------- |
| `blog_content`  | **provider** of a search source (posts `/blog/:code/:slug`) | unchanged                             |
| `news_portal`   | composes news posts, not an independent resource            | unchanged                             |
| `media_library` | **provider** (optional, follow-up) of media metadata        | unchanged                             |
| `site_search`   | **consumer/aggregator** (owns the index + the queries)      | `["tenant_admin", "identity_access"]` |

**The invariant that is locked:** no module names `site_search` in its `dependencies` or `consumes` (enforced by the test `tests/site-search-module.test.ts`). The direction of contribution is inverted from the naive design "search imports every content module": if `site_search` consumed a port owned by `blog_content`, the aggregator would drag a dependency onto every content module. By inverting the direction — content **declares** a search source, search discovers it through `listModules()` — `site_search` stays ignorant of any content module.

### 3. The contribution contract — why a descriptor list, NOT a `provides` capability

ADR-0038 modelled `seo_facts` as a **single** `provides` capability (only `blog_content` declares it, because `module-composition.ts`'s `checkCapabilityBindings` flags `capability_provider_conflict` when >1 module declares `provides` for the same string). For search we **do** want many content modules to contribute → modelling `search_source` as a `provides` capability would trigger that conflict immediately.

So the seam is a **descriptor list** — the existing `dataLifecycle`/`sodRules`/`reportingProjections` pattern: each module declares a `ModuleDescriptor.searchSources` array **in its own `module.ts`**, and `site_search` aggregates through `listModules()` (`site-search/domain/search-source-registry.ts`). `MODULE_CONTRACT_VERSION` goes `2.1.0` → `2.2.0` (MINOR, purely additive — every `module.ts` without `searchSources` stays valid).

**`SearchSourceDescriptor` is PURE DATA, not an executable extractor.** A descriptor declares, as build-time reviewed constants: `resourceType`, the source table/columns, the public URL template, a **declarative publication filter** (equals/notNull/isNull/timeReached), a relevance `weight`, and `privacyClassification`. A generic engine (`application/search-index-engine.ts`) builds PARAMETERISED queries from the descriptor — values are always bound parameters; only IDENTIFIERS (table/column names) are interpolated, and those are validated strictly (`^[a-z][a-z0-9_]*$`, tables must be prefixed `awcms_`) — **exactly the precedent of `data_lifecycle`'s generic executionMode**. Its CI gate is `bun run site-search:sources:check`, in the `bun run check` chain.

### 4. The index model — a tenant-scoped projection, deterministic reconcile

- **Index table** `awcms_site_search_documents` (RLS FORCE, one doc per `(tenant, source_key, resource_id, locale)`) with `search_vector tsvector GENERATED ALWAYS ... STORED` (`setweight` title=A/summary=B/tags=C/body=D) + a GIN index. A `pg_trgm` GIN index on `title` is **only** for typeahead suggestions.
- **reconcile** is deterministic: upsert every currently public doc (skipped when `source_checksum` matches), delete index docs whose resource no longer satisfies the source predicate. Idempotent: re-running while in sync is a no-op.
- **rebuild** is a fully idempotent rebuild (DELETE the tenant's docs → reconcile; the end state is identical whatever the starting state).
- **single-resource reindex** (`reindexSearchResource`) — an event-shaped primitive, the defence against stale leakage: archive/delete/unpublish removes it from public results with nothing left behind.
- **Event-driven**: in this base, `blog_content` publishes lifecycle as a **log line**, not a real outbox event. So **scheduled reconcile** (`bun run site-search:reconcile`) is the deterministic backbone today; `reindexSearchResource` is the seam that goes live the moment a content module publishes real lifecycle events.

### 5. The public query + suggestion contract

| Aspect                  | Invariant                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tenant/locale scope** | Every query is constrained by `tenant_id` (RLS FORCE + predicate) AND `locale`.                                                                                                  |
| **Publication state**   | Filtered at the source→index boundary; the index query is **not** an authorization source. No drafts/previews/private/deleted in results.                                        |
| **Query normalisation** | Trim, min/max length bounds, whitespace collapse, control-character stripping, then tokenized and into `to_tsquery('simple', $1)` as ONE bound param (see Amendment 2026-11-14). |
| **Snippet/highlight**   | `ts_headline` with a non-HTML sentinel → HTML-escape the whole thing → replace the sentinel with `<mark>` — markup from content never gets through.                              |
| **Pagination**          | Keyset cursor `(rank, id)`, bounded `LIMIT`.                                                                                                                                     |
| **Anonymous**           | Per-IP rate limit, query length bounds, result caps.                                                                                                                             |
| **Cache key**           | `buildSearchCacheKey` refuses to assemble a key without `tenant_id`+`locale`+`query`-hash.                                                                                       |

### 6. Tenant configuration, admin, retention/audit

- **Tenant config** (`awcms_site_search_settings`, RLS FORCE, 1 row/tenant, CHECK-bounded): `enabled`, `enabled_resource_types`, `result_limit`, `min_query_length`, `suggestions_enabled`, `suggestion_limit`, `analytics_enabled`.
- **Permissions** (`sql/065`): `site_search.index.{read,reconcile,rebuild}`, `site_search.settings.{read,update}`, `site_search.diagnostics.read`. `rebuild` is HIGH-RISK; `reconcile` is **deliberately not** high-risk (a projection sync that is entirely regenerable) but is still `Idempotency-Key`-ed + audited. `reconcile` is a NEW member of the `AccessAction` union.
- **Retention:** `awcms_site_search_query_log` and `awcms_site_search_index_failures` are registered as `generic` `HighVolumeTableDescriptor`s (ADR-0037). The index table itself is **not** — it is rebuilt, not purged.
- **Query logging** is opt-in + minimised: only the sha256 of the normalised query + length + locale + result count. The raw query is never stored.

### 7. awcms-specific adaptations (not port oversights)

| Area                | awcms-micro                     | Here                                                                                                                                                                                                                               |
| ------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public content URL  | host-resolved `/news/:slug`     | `/blog/:tenantCode/:slug` (ADR-0009) — the descriptor gets a `:tenantCode` placeholder that the engine resolves once per run from `awcms_tenants.tenant_code`, then encodes                                                        |
| `/search` typeahead | inline `<script>` ARIA combobox | **not ported** — this base's CSP has no `'unsafe-inline'` for scripts and the public page here is an HTML APIRoute with no bundling step. The page ships core no-JS; `/suggest` remains available for a theme's own bundled client |
| Page labels         | gettext `createTranslator`      | `DEFAULT_SEARCH_PAGE_LABELS` (this base has no i18n catalogue runtime) — kept as a parameter so that adding i18n later is a caller change                                                                                          |
| Registry gate       | unit test only                  | plus the CLI gate `site-search:sources:check` in the `check` chain (this base's convention for every descriptor registry)                                                                                                          |
| Blog PAGES          | not indexed (no route)          | same — not indexed; pages have no public route in this base, so a hit would 404                                                                                                                                                    |

## Threat model (part of acceptance)

| Threat                          | Control                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **SQL injection**               | Queries & filters are always bound parameters; descriptor IDENTIFIERS are validated strictly before interpolation.               |
| **XSS via snippets**            | `ts_headline` non-HTML sentinel → HTML-escape the whole string → replace the sentinel with `<mark>`.                             |
| **Draft/private leakage**       | The declarative publication filter is enforced at the source→index boundary; reindex removes anything that became non-public.    |
| **Cross-tenant / cross-locale** | RLS FORCE + `tenant_id`/`locale` predicates on every query; the cache key must carry tenant+locale; integration isolation tests. |
| **Query abuse**                 | Per-IP rate limit, query length bounds, result caps, bounded index (LIMIT + keyset).                                             |
| **Open redirect / path escape** | `:tenantCode`/`:slug`/`:id` are always `encodeURIComponent`d at index time; templates must be absolute paths without a scheme.   |
| **Cache poisoning**             | `buildSearchCacheKey` is tenant+locale+query-hash — it refuses a key without the isolation components.                           |
| **Search as an authz source**   | The index is ONLY a projection of public content; the source of truth for visibility remains the content module.                 |

## Out of scope (enforced)

SaaS search services/Elasticsearch/OpenSearch, vector/semantic AI ranking, cross-tenant global search, indexing private/business-admin data, and using the search projection as an authorization source — are **not** admitted. PostgreSQL FTS is the default until there is strong evidence it is not enough.

## Consequences

**Positive.** Search index ownership is explicit; a single authority for relevance/snippets/rebuild; a new content type contributes through one descriptor without `site_search` knowing any of them specifically. The DAG stays safe. Publication state, tenant/locale isolation, and snippet escaping are locked in as contracts from day zero. Local PostgreSQL FTS = offline-lan-safe.

**Negative / accepted trade-offs.** The index is a second projection (on top of the existing per-module `search_vector`) → it needs reconcile/rebuild for consistency; a deliberate cost in exchange for uniform cross-content search. Because `blog_content` publishes lifecycle as a log line, low-latency incremental indexing waits on real events; until then, scheduled reconcile is the backbone. The `/search` page ships without typeahead until there is a theme with a bundled client.

**Neutral.** `site_search` touches the same surfaces as `seo_distribution` (public URLs) and `visitor_analytics` (public queries) — coordination goes through descriptors/logs, not shared tables.

## Alternatives considered

- **Modelling `search_source` as a `provides` capability.** Rejected: >1 provider = `capability_provider_conflict`; a `listModules()` descriptor list is the right seam for many providers.
- **An executable extractor per module, wired at the composition root in the `seo_facts` style.** Rejected for source extraction: a pure data descriptor + a reviewed generic engine is narrower and easier to audit.
- **Folding search into the existing `blog_content`.** Rejected: cross-content search does not belong to one content module; a neutral aggregator is the right place.
- **An external search service (Elastic/OpenSearch/vector).** Rejected: there is no evidence PostgreSQL FTS is insufficient for the website scope.
- **Storing relative URLs without `:tenantCode` and adding the prefix at query time.** Rejected: the URL would be correct only for callers that remember to add it, and the document checksum would not catch a `tenant_code` change — storing the final URL makes a tenant rename automatically update the documents on the next reconcile.

## Amendment 2026-11-14: prefix matching on the last query token

The query-normalisation row of §5 originally handed the normalised string to `websearch_to_tsquery('simple', $1)`. That function matches whole lexemes only, so a half-typed word ("Kapu") found nothing, which defeats search-as-you-type. The query is now tokenized into runs of Unicode letters/digits (`[\p{L}\p{N}]+` after NFC normalisation) and assembled by `buildPrefixTsQuery`: every token is an exact lexeme, all ANDed, and the LAST token becomes a prefix (`token:*`) once it has at least 3 characters. The result is still bound as ONE parameter into `to_tsquery('simple', $1)`, and the same text is shared by the result list, the facet counts and the snippet, so a facet never counts a document the list cannot reach.

- **Injection.** Parameter binding already excludes SQL injection. Tokenization additionally excludes tsquery-OPERATOR injection: none of `& | ! : * ( ) < - >`, quotes or backslashes is a letter or digit, so no token can carry one. The separators and the `:*` suffix are written by the builder alone.
- **Accepted trade-off.** The `websearch_to_tsquery` syntax is gone: quoted phrases and `or` are no longer interpreted (their punctuation is dropped and the remaining words are ANDed). A `-word` exclusion is dropped WHOLE, so it neither excludes nor becomes a required word: `politik -korupsi` now means `politik`, and consumers or bookmarked URLs that relied on exclusion lose that filter (it is NOT inverted).
- **Empty token set.** A query with no word tokens (pure punctuation or symbols) returns the neutral empty result without touching the database.
- **Out of scope.** The `blog_content` per-module search keeps `websearch_to_tsquery`. The suggest endpoint is unchanged (its trigram `ILIKE` is already a substring match). Response shapes are unchanged (ADR-0065).
- **Empty-query guard.** The early exit for a query with no word tokens is an optimization, not a control: a tsquery that is empty on the database side matches nothing, and integration tests pin that through the database path.
- **Index.** No migration: the GIN `tsvector` index supports `:*` prefix operands, which is what a superuser plan shows. It is NOT what the runtime role gets: under `FORCE ROW LEVEL SECURITY` the tenant policy is a security barrier and `ts_match_vq` (the `@@` function) is not LEAKPROOF, so the planner cannot use it as an index condition and the plan is a tenant-bounded sequential scan with `ts_rank` per candidate. This already held for `websearch_to_tsquery`; a 3-character prefix widens the candidate set. Impact is bounded by the public rate limit and `statement_timeout`. Marking `ts_match_vq` LEAKPROOF is NOT done here and requires its own ADR; an explicit tenant-filtered read path is the alternative. Tracked in #1321; a test pins the current runtime plan so a real fix turns it red on purpose.
