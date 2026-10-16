---
"awcms": patch
---

test(booking, hr_workforce): reproducible load, stress and concurrency benchmarks (#967). `bun run bench:booking` runs the booking allocator (last slot, last night, pool of 3 at 8 and 32 workers), availability reads at 500 resources and 2,000 live holds, the hold-expiry reaper draining a 5,000-hold backlog while claims race it, and hr_workforce attendance event ingest, against the integration harness's throwaway database under the production roles. It is a separate target (not a `*.test.ts`, not in `bun test`, `tests/integration/` or `bun run check`): correctness invariants always fail the run, p95/throughput thresholds are a documented regression gate. Numbers and hardware: `docs/awcms/booking-benchmarks.md` (+ `.id.md`). The integration harness gains `reassertRuntimeRoleLogins()` so a minutes-long run survives another process's teardown. No migration, no runtime behaviour change.
