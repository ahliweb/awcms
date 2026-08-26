---
"awcms": patch
---

test(blog): two gates added by this branch stayed green when their own defect was restored, because both mutations were applied at the wrong grain

Found while working on Issue #599 / Issue #711 (neither of which this change
closes — per ADR-0114 this repo cannot). Both directions were proved by
execution: red under the mutation, green without it.

**`IMPORT_CHUNK_SIZE` was never asserted by identity.** The test's own comment
said _"Identity, not equality of two literals"_, and the assertion under it was
`expect(IMPORT_CHUNK_SIZE).toBe(MAX_REDIRECT_IMPORT_ITEMS)` — two VALUES.
Restore the pre-fix shape, a hard-coded `= 200` under a comment claiming it
mirrors the endpoint, and it stays green at 12 pass / 0 fail, because `200`
does equal `200` today. The mutation that "proved" it had changed two things at
once: the literal AND the endpoint's cap. What actually caught the copy was
`typecheck`'s TS6133 on the now-unused import — a grip that disappears the
moment someone deletes the import along with the literal. The test now also
asserts, over the builder's source with comments stripped first
(`scripts/lib/source-text`), that `IMPORT_CHUNK_SIZE = MAX_REDIRECT_IMPORT_ITEMS`
literally appears. It goes red on the re-hardcode alone, and red again when the
binding is present only in a comment. The value assertion is kept: each catches
what the other cannot.

**The in-file slug dedupe was gated only by the DB-gated suite.** The DB-free
test pinned the identifier `seenSlugs` and its position relative to
`categoriesPerArticle.push`. Delete only the `continue;` from the collision
branch — leaving the Map, the refusal push and the ordering intact — and the
DB-free files are green at 43 pass / 0 fail on a dedupe that does not dedupe,
while the integration test correctly dies on the real 23505. Anyone running the
documented `DATABASE_URL="" bun run check` before pushing saw full green, and
this is data-loss-adjacent: 84 collision groups over 171 rows kill a real run
mid-batch, after earlier batches have committed.

The fix is structural rather than a sharper string match. The per-row decisions
of `bun run blog:legacy:import` move out of `main` into an exported pure
`planLegacyImportRows`, which needs no database because the media map and term
map it consults are already verified against the tenant by `main` before the
first line is read; `main` keeps those two verification sweeps, the one
`findTakenSlugs` query and the batched write. Four DB-free tests now read the
returned `accepted` / `refusals` / `categoriesPerArticle` instead of the file's
source text, and the `continue`-only mutation turns two of them red.

No change to what the CLI does: verified against a real Postgres at 6/6 on
`tests/integration/legacy-import-cli.integration.test.ts` and 593 pass / 0 fail
across `tests/integration/`. Two incidental corrections came with the
extraction — the script's entrypoint now sits behind `import.meta.main`,
because importing an unguarded CLI runs it (`usage()`, `process.exitCode = 1`,
and the whole suite exits non-zero for a reason nothing in it mentions), and
the lazily-opened database client moved from a bare `let` onto an object,
because TypeScript's control-flow analysis cannot see a closure's assignment
and read `sql` as exactly `null` in the `finally` once `main` was small enough
to analyse.
