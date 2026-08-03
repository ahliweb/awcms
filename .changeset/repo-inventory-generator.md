---
"awcms": patch
---

Make `docs/awcms/repo-inventory.md` an actually-generated document (`bun run repo:inventory:generate|:check`).

It carried a "GENERATED FILE — jangan diedit manual" banner while no generator existed, and it aged in the direction that does the most damage: the body said "belum ada tabel" and "belum ada test file" against 126 tables and 295 test files, gave the migration count as **45** in one paragraph and **89** in another, and listed **20** modules where the registry holds 21. A negative claim is the dangerous kind — "X does not exist yet" gets more wrong with time and never fails on its own.

The derivable half is now derived and the prose half is not, following `scripts-inventory.ts` exactly: everything between the markers comes from the module registry, `sql/*.sql`, `tests/`, `src/pages/` and `docs/adr/`, and `repo:inventory:check` joins the `check` chain. The check parses the block back into rows rather than comparing bytes, because prettier owns markdown padding and the two would otherwise fight forever.

RLS state is parsed from the migrations, not read from a database, so the inventory is available where it is most useful (CI, a fresh clone, a review). That parse is cumulative and order-sensitive on purpose: `sql/020` toggles `NO FORCE` on `awcms_offices` for a data repair and turns it back on 40 lines later, so a parser reading the first or last statement alone would report the opposite of the truth. `security-readiness.ts` remains the authority for a live deployment.

One cross-artefact test ships with it, and it is the part with teeth: the set of tables the generator derives as RLS-free must equal the keys of `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` in `security-readiness.ts` — one side derived from the migrations, the other hand-maintained with a reason per entry. A disagreement means either a new global table shipped without declaring which privileges `awcms_app` must not hold on it, or a tenant-scoped table shipped without RLS. Today both sides are the same eleven.
