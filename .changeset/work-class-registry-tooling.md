---
"awcms": patch
---

Build the work-class registry generator + freshness gate, and retire the ghost
artifact it was supposed to produce.

`docs/awcms/work-class-registry.generated.json` carried a `.generated` suffix
with no generator and no check behind it. It listed ~284 awcms-mini routes,
mostly ghosts, while its own `_disclaimer` claimed to describe "96 real routes"
in a repo that has 221 — the data was stale and so was the warning meant to stop
readers trusting it. Both `docs/awcms/README.md` and the capacity runbook cited
it.

`bun run db:work-class:generate` / `db:work-class:check` now produce and verify
it from this repo's own routes and jobs, wired into `bun run check` and
`ci.yml`. Routes are derived from source (`defineTenantRoute`'s required
`workClass`, an explicit literal on `withTenant`, or the documented default);
jobs come from `JOB_WORK_CLASS_REGISTRY`, cross-checked against the scripts that
actually open a worker connection.

That cross-check refused to generate on its first run, correctly: four worker
scripts from the awcms-micro wave (`comments-retention`, `edge-cache-purge`,
`site-search-reconcile`, `tenant-domain-dns-sync`) had no entry and were outside
the capacity model, and four entries described scripts that do not exist here.
Both directions are fixed.

`tests/generated-artifacts-have-tooling.test.ts` makes this a class of defect
rather than one incident: any `.generated` file without a generate/check pair
wired into the check chain now fails CI.
