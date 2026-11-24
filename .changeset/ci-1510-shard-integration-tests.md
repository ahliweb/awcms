---
"awcms": patch
---

ci: the DB-gated integration tests now run as five parallel jobs (`Integration shard <i>/5`, Bun `--shard`, each on its own runner with its own Postgres service, `fail-fast: false`) instead of one ~37.5-minute step. The required check `Integration tests (RLS + DB role separation)` is now an aggregator job (`needs` every shard, `if: always()`) that fails unless every shard concluded `success`; its name and the ruleset are unchanged. The payroll catalog boundary and the legacy ad-hoc suite run once, on shard 1. `ci:local` still runs the whole directory against one throwaway database. New `tests/ci-integration-shards.test.ts` pins the aggregator and the matrix. Tooling and docs only; no runtime change.
