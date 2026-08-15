🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0067-core-web-vitals-collection.id.md)

# ADR-0067 — Core Web Vitals collection: a decision, not a defect

- **Status:** Accepted (not yet implemented)
- **Decision:** Option D (landed 5 August 2026) + **Option B** (decided 8 August 2026, not yet built — §Addendum 2026-08-08)
- **Date:** 2026-08-04 (RUM decision: 2026-08-08)
- **Decision maker:** @ahliweb
- **Related:** [`../awcms/repo-assessment-2026-08-04.md`](../awcms/repo-assessment-2026-08-04.md) §5 (recommendation #7), [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (edge cache), [ADR-0064](0064-foreign-key-columns-must-be-index-reachable.md) (the first performance gate)

> **Why this ADR was `Proposed` for four days.** The six other recommendations
> from the 4 August 2026 assessment have landed. This one has **not**, on
> purpose: it is the only one that does not fix a defect, but instead **adds
> collection of data about real visitors** — and that collides with the posture
> the target module has already declared. The decision belongs to the product
> owner, not to the person who wrote the assessment.
>
> **That decision was taken on 8 August 2026 — see §Addendum 2026-08-08.**

## Context

### 1. What is genuinely missing

This repo serves real HTML: `/news/**` (ADR-0059 — **no longer in force**,
[ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
removed that route family from this repo on 8 August 2026; the original sentence
is kept because it was true when this ADR was written and the scope of the
decision below shrinks accordingly), `/blog/{tenantCode}/**`
(ADR-0009), and 31 admin screens. **LCP / INP / CLS are never measured
anywhere**, and there is no asset size budget.

The consequence is specific and can be stated: the entire edge cache investment
([ADR-0042](0042-varnish-edge-cache-auto-activation.md),
[ADR-0061](0061-host-resolved-public-surfaces-are-edge-cacheable.md), 11 surfaces)
**is proven against origin load, never against user experience**. We know
database queries went down. We do not know whether the page feels faster.

The relevant standards: **Core Web Vitals** (Google) as the field metric, and
**ISO/IEC 25010 — Performance efficiency (time behaviour)** as its umbrella.

### 2. Why this is NOT merely "add a table to `visitor_analytics`"

That module declares itself **privacy-first**, and not as a slogan:
`purgeVisitorAnalyticsData` performs DELETE/UPDATE-to-null **with no archive
step**, on the written grounds that raw/near-raw visitor detail is
**deliberately not kept longer than necessary**, so that archiving it would
actually work against its own module's posture.

Core Web Vitals samples are **per-visit telemetry**: URL, timings, and — if you
want them to be useful — device/connection hints. That is exactly the class of
data that module decided to minimise. Adding it silently would be a reversal of
a design decision nobody asked for.

## The options, and the actual trade-offs

### Option A — Do not collect (status quo)

No field data. Performance keeps being judged through proxies: query counts
(recommendation #6, already landed), edge cache hit rate, origin latency.

**Who this is enough for:** deployments whose pages are simple and whose
question is "can the origin cope", not "are visitors waiting".

### Option B — Aggregates only, no per-visit rows

The client script sends one sample; the server **aggregates immediately** into
buckets per (tenant, normalised route, day) — storing counts + the p75
percentile, **never the raw row**. No full URLs, no identity, no join to the
session.

**What you get:** p75 LCP/INP/CLS per route — exactly the numbers Core Web
Vitals defines as its thresholds, and enough to answer "did the edge cache
improve the experience".

**What you pay:** you cannot drill into a single slow visit. Accepted under this
reading: diagnosing ONE slow visit is APM work, not CMS work, and it is
precisely that drill-down that demands storing raw data.

**Consistent with the module's posture?** Yes — aggregating at the entry point
means no raw visitor detail is ever stored, so `purge` has nothing to delete and
the module's privacy promise does not change.

### Option C — Raw rows + retention

Store per-visit samples, purge via `dataLifecycle`.

**REJECTED in this draft.** It reverses the module's explicit decision for a
capability (drill-down) that no recorded requirement demands. If it is ever
needed, it deserves its own ADR with that requirement written down.

### Option D — LAB measurement, and it is orthogonal to A/B/C

> **Added 4 August 2026 (second-round assessment §9.9).** The first draft of
> this ADR offered three options that were **all RUM** — all of them collecting
> data from real visitors. That made the whole decision collide with the privacy
> posture of `visitor_analytics`, and that is why it waited. There is a fourth
> path that was never weighed, and it waits for nothing.

Run Lighthouse/Playwright against our own build in CI. **Zero** visitor data: no
client script, no public endpoint, no table, no touching `visitor_analytics`.
This repo **already** has Playwright installed and an env-gated E2E suite, so the
cost is configuration, not a new capability.

**What makes it not a replacement for A/B/C:** lab and field answer different
questions, and swapping one for the other is a mistake far more common than not
measuring at all.

| Question                                    | Answered by |
| ------------------------------------------- | ----------- |
| "Does this change make the page slower?"    | **Lab**     |
| "What do our visitors actually experience?" | RUM (B)     |

Lab measures one machine, one network, one run — it **cannot** answer the p75 of
real visits, and writing its numbers down as if it could would be exactly the
class of defect this document exists to prevent. What it can do, and what A
cannot: **turn CI red** when a change regresses LCP on the same page on the same
machine.

The limit that must be written down too if this option is taken: a lab gate that
passes itself when there is no content source is a gate that rots (`awcms-astro`
records exactly that as the reason its gap 8 stays open in the template repo).
Here the problem is smaller — this repo has real tenants and real content in
staging — but the gate must still **declare** when it is not running.

## Recommendation

**Option D now, and Option B only if the product owner genuinely wants field
numbers.** They can live together; D does not wait on the decision about B, and
that is the main reason for separating them.

If field numbers are not wanted, **Option A remains a legitimate answer** for the
RUM part — and with D taken, "not measuring at all" stops being the consequence.

What is NOT recommended under any circumstances: adding it as "just another
table" without an explicit decision, because the target module's privacy posture
is already written down and its reversal must be visible.

## If Option B is taken, its shape

1. A small client script (no dependencies) on public pages, using
   `PerformanceObserver`; reporting once on `visibilitychange`.
2. `POST /api/v1/analytics/vitals` — public, unauthenticated, **rate-limited via
   `checkSharedRateLimit`** ([ADR-0066](0066-shared-rate-limiting-and-full-auth-surface-coverage.md)),
   body-capped, route normalised to a PATTERN (`/news/[slug]`) before anything
   is written.
3. One aggregate table with `tenant_id`, FORCE RLS, unique on
   `(tenant_id, route_pattern, day, metric)`; an `UPSERT` that updates the count
   - percentile sketch. **No raw-row table.**
4. Displayed at `/admin/analytics` alongside the existing statistics.
5. Its FK columns must pass `db:fk-index:check` (ADR-0064) from its first
   migration onwards.

Estimate: one migration, one endpoint, one client script, one screen section —
comparable to a small module, not to a patch.

## Addendum 2026-08-05 — Option D taken and landed

**Option D was implemented**, exactly as §Recommendation states it ("Option D
now, not waiting on the decision about B"). This ADR's status **remains
`Proposed`**: what waits on the product owner's decision is the RUM part
(Option A/B/C), and this addendum does not touch it.

Its shape — zero visitor data, zero new surfaces:

- **File:** `tests/e2e/cwv-lab.e2e.ts` — a Playwright spec in the existing E2E
  harness (not a second harness), measuring **LCP** and **CLS** of the
  `/login` page (a public surface the E2E smoke already touches) via
  `PerformanceObserver` with `buffered: true`, with CLS computed per the CWV
  session-window definition.
- **Gate:** env `E2E_CWV_LAB=1`, turned on by the `e2e-smoke` CI job
  (`.github/workflows/ci.yml`) in the same step as
  `bun run test:e2e`. The pass thresholds are the CWV "good" thresholds:
  LCP ≤ 2500 ms, CLS ≤ 0.1.
- **Script:** `bun run perf:cwv:lab` runs the spec on its own against a server
  provided by the caller (the E2E suite convention).

The limits §Option D requires, and how this addendum meets them:

1. **A gate that is not running says so.** Without `E2E_CWV_LAB` the spec prints
   an explicit `[cwv-lab] SKIP: …` line and marks the test skipped — it never
   passes silently. When it does run, an LCP that is not recorded (an observer
   with no entries, or a browser without support for the entry type) is a
   **failure**, not a pass.
2. **Lab numbers are not written as if they were field p75.** The threshold
   constants carry the comment "a LAB number from one machine — a regression
   detector, not field p75", and the per-run log prints the same sentence.
   **INP is not measured and not claimed** — without real user interaction it is
   meaningless in a lab.

## Addendum 2026-08-08 — Option B taken; the RUM part stops dangling

**The product owner took Option B.** The RUM part deliberately left open on
4 August now has an answer, and this ADR moves from `Proposed` to
`Accepted (not yet implemented)`.

What was taken is exactly Option B as written, with no loosening:

- **Aggregation at the entry point.** The server never stores a per-visit sample;
  it `UPSERT`s into buckets per (tenant, route pattern, day, metric). There is no
  raw-row table, no full URL, no identity, no join to the session.
- **Option C remains REJECTED.** If per-visit drill-down is ever needed, it gets
  its own ADR with its requirement written down — not a silent extension of this
  decision.
- **The `visitor_analytics` privacy posture is not reversed.** Quite the
  opposite: because no raw visitor detail is stored, `purge` has nothing to
  delete and the module's promise stands as it is.

### Why the status is qualified, and what enforces it

`Accepted (not yet implemented)`, not plain `Accepted`, because not a single
line of §"If Option B is taken, its shape" has been built. That qualification is
**gated**: this ADR now has an entry in the
`tests/adr-implementation-status.test.ts` map, which enforces it in both
directions — as long as the artifact does not exist, the qualification is
mandatory; the moment the artifact lands, the qualification must be removed in
the same PR.

The mapped artifact is
`visitor-analytics/domain/web-vitals-aggregate.ts` — **the aggregate**, not the
endpoint and not the migration. That is deliberate: the heart of Option B is
that raw rows are never stored, so the file that does the aggregation is this
decision in executable form. Mapping it to the endpoint would let a raw-row
implementation satisfy the gate.

### What the implementation PR must carry, beyond §"If Option B is taken, its shape"

`POST /api/v1/analytics/vitals` is a **public write surface without
authentication** — the class of surface this repo has the fewest of. It must
therefore carry, and be reviewed for, the things the other public surfaces here
already carry:

1. `checkSharedRateLimit` ([ADR-0066](0066-shared-rate-limiting-and-full-auth-surface-coverage.md))
   and a request body cap, both before a single row is written.
2. Route normalisation to a **PATTERN** before storage, with a pattern list
   derived from routes that actually exist — a `route_pattern` accepted verbatim
   from the client is a column filled in by an attacker.
3. Metric values with validated ranges. Unbounded samples from an untrusted
   client are the most direct way to make a tenant's p75 meaningless.
4. `VISITOR_ANALYTICS_ENABLED` remains the switch. A new installation still
   collects nothing until the operator chooses it — Option B adds to what is
   collected when that switch is on, it does not change its default.
