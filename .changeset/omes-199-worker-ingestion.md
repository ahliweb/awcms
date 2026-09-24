---
"awcms": minor
---

feat(control-center): OMES worker enrollment, poll, result, and heartbeat ingestion (ahliweb/omes#199)

Adds the AWCMS server-side counterpart the outbound OMES pull worker (ahliweb/omes#192) talks to: `POST /api/v1/omes/worker/{enroll,poll,result,heartbeat}`. These are the highest-risk surface `omes_control` ships — session-UNauthenticated by design (ADR-0027's outbound-pull architecture), authenticated instead by asymmetric Ed25519 worker identity with proof-of-possession enrollment, a canonical-envelope signature over every subsequent request, and a persisted, atomic nonce/replay store.

- **Enroll** redeems a single-use, short-lived challenge (#198's `POST .../enrollment-challenges`) via a genuine DB-level compare-and-set (`SELECT ... FOR UPDATE` + same-transaction `UPDATE`), requiring a signature over the raw challenge under the presented public key before the row is touched.
- **Poll** promotes an `approved` operation request into a queued job (a bridge #198 left undone), leases it with `FOR UPDATE SKIP LOCKED`, and returns it conforming exactly to the pinned `operation-request` contract.
- **Result** ingestion is idempotent by `(tenant_id, server_id, idempotency_key)` — not the wire `job_id`, which turns out to be the worker's own opaque local identifier, not something AWCMS assigned. Every recorded row is stamped `source: "worker_reported"` / `reconciled: false`; a 2xx is never presented as confirmed success anywhere in this module.
- **Heartbeat** updates redacted, `omes-host`-attributed telemetry and never resurrects a decommissioned server's status; staleness stays a pure function of heartbeat age computed on read.

`verifyWorkerEnvelope` is the single chokepoint poll/result/heartbeat call before any other side-effecting work. Adds `awcms_omes_worker_nonces` and `awcms_omes_worker_results` (sql/159, RLS enabled+forced, `awcms_worker`'s grant narrowed to SELECT+DELETE matching sql/156's existing pattern), an `idempotency_key` column + unique constraint on `awcms_omes_jobs`, and OpenAPI/threat-model/module README documentation (EN+ID).

Flags a cross-repository gap rather than working around it silently: the OMES-side reference pull worker (ahliweb/omes#192) does not yet generate real Ed25519 keys or send signature/nonce/timestamp headers — this module does not relax verification to match that stub.
