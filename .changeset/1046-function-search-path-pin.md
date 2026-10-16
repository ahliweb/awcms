---
"awcms": patch
---

Pin `search_path = pg_catalog, public, pg_temp` on the 30 trigger functions that lacked it (29 when written, plus the `sql/284` booking reminder guard from #943) (migration `sql/296`), and add the gate `db:function-search-path:check` to `bun run check` (Issue #1046). `awcms_app` and `awcms_worker` hold `TEMP`, and PostgreSQL resolves unqualified relation names through `pg_temp` before `public`, so a role could `CREATE TEMP TABLE` a same-named shadow and feed a guard trigger fake rows (the way #1032's triggers were bypassed). The gate folds `sql/` in order, judges the final definition of every `RETURNS trigger` / `SECURITY DEFINER` function, and requires `pg_temp` named last. No behaviour change for legitimate writes; bodies are untouched.
