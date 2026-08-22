---
"awcms": patch
---

refactor(ui,\_shared,scripts): three duplications that had already cost something

PROJECT_STATE §4 **D12**, **D13**, **D14**. Each reads like tidying and is not:
every one of the three had already produced a difference nobody chose.

**D12 — one JSON mutation, three projections.** `src/lib/ui/` held three
near-identical copies of the same `fetch`, and they had drifted: `sendJson` and
`sendJsonForData` supported `extraHeaders`, bodyless requests and `DELETE`;
`sendJsonWithFieldErrors` supported none of it until Issue #596 added the first
by hand — which is why `/admin/seo` reported "invalid" without saying which
field. The three are now projections of one `sendJsonRequest`. They stay three
public functions on purpose: `sendJson`'s narrow `{ ok, errorCode }` is what
stops thirty-odd screens painting internal detail onto the page (Issue #540),
and widening it for everyone to serve two callers would remove that property
from all of them. `postJson` is deleted — zero callers, and a docblock claiming
to serve "the existing create-form call sites" that made it look load-bearing.

The two copies also disagreed about header precedence: the field-errors one
merged `extraHeaders` OVER `Content-Type`, so a caller could have replaced it.
Nothing did. The kept order is the one both docblocks claimed.

Four other files in `src/lib/ui` fetch with same-origin credentials and are
deliberately not folded in — two are GET reads, and
`push-subscription-client.ts` surfaces the server's own `error.message` and
`data.subscription.endpointMasked`, which is exactly what the narrow shape
exists to withhold.

**It recovers no client bytes, and the claim that it would was wrong.** Both
files were already shared chunks shipped once each, so "three copies of the
bytes" was never true — three copies of the SOURCE shipped once. The 425 B
"saving" measured during the work came from a `dist/` the build had not cleaned;
clean builds either side of this change are byte-identical. `bun run build` now
runs `rm -rf dist` first so the number cannot come from a tree the build did not
produce — the budget script's own docblock had already recorded being misled
this way twice.

What the change is worth stands on the drift, the dead wrapper and the silent
header disagreement, which is what the finding was actually about.

**D13 — one timestamp expression, not twenty-one.** `KEYSET_CURSOR_CREATED_AT_SQL`
hardcoded a bare `created_at` while its own docblock told callers to "wrap it in
a table alias at the call site", which is not something a string can do — so
every joined query wrote its own. It is now `keysetCursorCreatedAtSql(alias?)`
over a shared `utcMicrosecondTextSql(column, offsetSuffix)`, and all the copies
are gone. The audit counted twenty; there were twenty-one, because three more
render the same expression for `occurred_at` and `last_seen_at`, and the
`idn_admin_regions` DTO renders it with a `Z` suffix.

All were byte-correct, which is not the same as safe: `AT TIME ZONE 'UTC'` and
`US` are both silent when wrong, and getting `US` wrong resurrects #158 — a
cursor denoting an instant earlier than its own row, skipping every row in that
millisecond, past page one only. A test refuses any `to_char(… AT TIME ZONE
'UTC'` outside the owning module; it matches the RENDERING rather than the
correct format string, because an edit that gets a character wrong is the case
it exists to catch. The column reference is asserted to be an identifier, since
callers hand the result to `tx.unsafe`.

**D14 — finishing the `scripts/lib/` extraction.** Three shared modules:

- `markdown-table.ts` — `extractBlock`/`replaceBlock` were byte-identical
  copies; `parseInventoryRows` was not. One copy had learned about `\|` escapes
  because its own table holds a shell pipeline; the other split on a bare `|`
  and would have torn that cell. The escape-aware version is a strict superset,
  so it costs the other caller nothing.
- `migrations.ts` — **six** copies of the loader, and the non-empty assertion
  existed in exactly one. Every caller asks "which tables exist, and which have
  RLS forced", and an empty list answers all of them with a confident, wrong
  "none" — a gate reporting full coverage of nothing. It now resolves `sql/`
  from the repository root, which only `sql-grants.ts`'s copy did, so no gate
  depends on where it was run from.
- `table-rls-states.ts` — `deriveTableRlsStates` was exported from a
  documentation GENERATOR and imported by two gates. A gate that fails because a
  generator was refactored teaches a reader that the gate is fragile.

Both `catch { return; }` walkers in `edge-cache-surfaces-check.ts` now use the
shared walk, which throws on an unreadable root. A gate that silently skips a
directory reports "no violations" for a tree it never opened — and for that one,
a missed purge call site is a stale cross-tenant page.

Both new gates were verified to FAIL on a real defect, not merely to pass.
