---
"awcms": patch
---

test(integration): provider-failure fault injection for the existing outbox/worker adapters (Issue #1411). A new integration suite drives fake providers against a disposable PostgreSQL for the R2 object queue, email, WhatsApp and push: `429` with bounded `Retry-After`, `5xx`, HTTP-200 semantic refusal, timeout before send versus lost ACK after provider acceptance (status stays unknown, never retried blindly), half-open breaker concurrency through the real adapters, crash/lease expiry/dead letter, two-tenant isolation and worker least privilege. Two proven R2 defects are recorded as `test.todo` and fixed separately in #1432. Tests only; no runtime change.
