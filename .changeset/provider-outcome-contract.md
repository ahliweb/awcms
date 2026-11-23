---
"awcms": minor
---

feat(integration): add `src/lib/integration/provider-outcome.ts`, a pure, versioned (`PROVIDER_OUTCOME_CONTRACT_VERSION` 1.0.0), provider-neutral contract for third-party call outcomes (`succeeded`, `accepted`, `not_sent`, `confirmed_failed`, `unknown`) and a default-deny routing decision (`hold`, `retry_same`, `switch_provider`, `reconcile`, `manual_review`). Failover is off by default; an `accepted` or `unknown` outcome never switches provider, and for financial operations never retries or switches automatically. A 200 with a failure body is a failure, and a 429 `Retry-After` is clamped to 5 minutes. No live adapter uses it yet (adoption is a separate opt-in change), no endpoint or event is added, and there is no flag. Documented in `docs/awcms/provider-outcome-contract.md`.
