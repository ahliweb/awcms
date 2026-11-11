---
"awcms": patch
---

fix(gates): `modules:table-writes:check` now scans `scripts/**/*.ts` instead of only `scripts/*.ts` (Issue #1268), so the readiness probes under `scripts/lib/` are actually read and their `(scripts tooling)` exceptions are exercised. It surfaced one write the exceptions did not cover (the telegram dispatch probe's refused forged opt-in on `awcms_telegram_engagement_consents`, always rolled back); that table is now excused with the same always-rolls-back reason. New tests fail when a tooling write to any table lacks an exception, and when a tooling exception matches no real write. No runtime or schema change.
