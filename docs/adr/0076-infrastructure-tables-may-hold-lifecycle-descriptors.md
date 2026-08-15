🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0076-infrastructure-tables-may-hold-lifecycle-descriptors.id.md)

# ADR-0076 — Infrastructure-owned tables may hold retention descriptors, and a write-ownership classifier decides which ones may

- **Status:** Accepted
- **Date:** 2026-08-10
- **Decision maker:** @ahliweb
- **Related:** Issue #479 (blocker for #468), [ADR-0037](0037-data-lifecycle-module-admission.md) (retention registry), [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (the invalidation queue that became its first case), [ADR-0072](0072-decision-log-retention-and-projection-authority.md) (the retention framework reused here), [ADR-0013](0013-extension-layers-and-boundary-model.md) §6 (no shared-table write)

## Context

`HighVolumeTableDescriptor` is declared by the **module that owns the table**, and `lifecycle-registry.ts` enforces that `ownerModuleKey` equals the module key that declares it. That rule is correct and this ADR does not loosen it: without it a module could write a retention policy for another module's table, and the real owner would never find out.

What the rule did not anticipate is a table that has **no owning module at all**.

`awcms_edge_cache_purges` is the example, and it is not an accident: it lives in `src/lib/edge-cache/`, which is **deliberately** not a module — the same as the database subsystem, rate limit, and SSRF guard. It is written by three modules (`blog_content`, `theming`, `seo_distribution`) through a single infrastructure function, and `scripts/table-write-ownership-check.ts` has classified it as `"(src/lib infrastructure)"` for a long time. Zero ownership there is a recorded decision, not a gap.

The consequence is that the table sat in `TABLES_PREDATING_THE_RULE` not because nobody had got round to it, but because the contract could not express it. And **that difference is invisible from the ledger**: a table that cannot possibly be described looks exactly like a table that has not been described yet. That is the real problem — not one table slipping through, but a ledger that stopped being readable as a count of debt.

### One correction to Issue #479's premise

The issue states that "nothing deletes them today". That is **not true**, and the error changes the shape of this decision. `bun run edge-cache:purge` already calls `pruneCompletedEdgeCachePurges`, which deletes `done` rows older than seven days — a hand-rolled retention mechanism that has been working since ADR-0042.

That means what this table needs is **not** a new purge. What it needs is a way to **state the purge that already exists** in a contract a gate can read — precisely the definition of `executionMode: "delegated"`, which already exists in the contract and reads: _"the owning module already has its own hand-rolled purge/retention function"_. The only word standing in its way is **module**.

What genuinely was unbounded: `failed` rows. Their docblock states that they are kept forever on purpose, and the reason is sound — those rows are the only trace that an invalidation never landed. "Forever" is still unbounded, and a descriptor that names a retention window while leaving one status class eternal would be exactly the kind of false claim this ledger forbids.

## Decision

**Infrastructure-owned tables may hold retention descriptors, through their own second registry — and what decides whether a table may be there is the write-ownership classifier that `modules:table-writes:check` already uses, not the descriptor author's judgement.**

Three parts, and the third one carries the weight.

### 1. A second registry, not a loosened `ownerModuleKey`

`INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS` lives in `data-lifecycle/domain/infrastructure-lifecycle-registry.ts`. Its shape is `HighVolumeTableDescriptor` **without** `ownerModuleKey`, **plus** `ownerPath` (the `src/lib/` directory that owns its schema).

The alternative that was rejected: making `ownerModuleKey` optional. It saves one file and pays for it with every module descriptor losing its mandatory guard — a descriptor that forgets to name an owner would stop being an error and start meaning "infrastructure". A typo becomes an ownership claim, silently. Two registries make that choice explicit at the point where it is taken.

### 2. `delegated` only — infrastructure cannot use the generic engine

The generic `data_lifecycle` engine deletes **on behalf of the owning module**. Without a module there is no one to act on behalf of. An infrastructure descriptor must therefore be `executionMode: "delegated"` and must carry an `existingAdopter` naming its function and its job command. This is not a temporary restriction: an infrastructure table that does not yet have a purge must not discharge its obligation by pointing at the engine — it has to write its purge, like every module.

### 3. The classifier decides, not the author

The real danger of a second registry is that it becomes a parking space: a module-owned table gets moved there because writing its descriptor in that module is inconvenient. What prevents that is not a written rule but `ownerOfFile()` — the function `modules:table-writes:check` already uses to answer "who writes this table".

`data-lifecycle:registry:check` now scans `src/` with the same scanner and rejects:

- an infrastructure descriptor for a table whose writer is a **module** → the table belongs to that module, declare it there;
- an infrastructure descriptor for a table that **nobody writes** in `src/` → there is no evidence it is infrastructure, and a table without a writer has more urgent questions;
- a table that appears in **both** registries.

The consequence: wrong ownership cannot be stated, in either direction, and no polite sentence can get around it. This closes Issue #479's explicit worry — _"a descriptor naming the wrong owner is a false claim that reads as a decision"_ — with a gate instead of a paragraph.

The gate therefore stops being pure: it reads `src/`. That is a price paid knowingly, and it is paid once — `data-lifecycle:table-coverage:check` next to it already reads `sql/`.

### `failed` rows get a bound, and legal hold arrives

Two behavioural changes land together with the descriptor, because without both the descriptor would not be true:

- **`failed` is deleted after 180 days.** The useful life of a failed-invalidation record is bounded by the TTL of the object that failed to be invalidated; after six months that content has expired thousands of times and the row is archaeology. The operator visibility that was the original reason stays intact — six months is far beyond any window in which someone would act.
- **Its purge now honours legal hold**, through the very same `LegalHoldGuardPort` as the other seven delegated purges. Without this, `legalHold.applicable: true` would be a declaration without an enforcer — and `applicable: false` would become the way a table exempts itself from legal hold by declaring so, which ADR-0037 forbids.

## Consequences

`TABLES_PREDATING_THE_RULE` shrinks by one, and this time because the debt was paid, not because the entry was moved. The next infrastructure table that is born has a path to answer the retention question without pretending to be a module, and has no path to claim to be infrastructure when it is not.

What is **not** decided here: whether `src/lib/edge-cache/` should become a module. Issue #479 offered that as a second option, and it stays open — this ADR only removes the weakest reason to do it, namely "so the gate goes green". If the edge cache eventually becomes a module for a genuine architectural reason, its descriptor moves into its `module.ts` and the infrastructure registry shrinks; the gate will demand that move itself, because its writer changes from `src/lib` to a module.
