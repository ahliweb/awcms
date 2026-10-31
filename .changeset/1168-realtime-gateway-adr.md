---
"awcms": patch
---

Record ADR-0154 (Issue #1168, Proposed): realtime campaign, delivery-status and inbox progress is served by SSE on the existing Bun process through the ADR-0075 per-tick re-authorized seam, reading durable PostgreSQL state with database cursors and `Last-Event-ID` resume; native Bun WebSocket is not admitted until a bidirectional need is proven and a later ADR meets the listed conditions (single-use ticket, Origin, per-frame authorization). The stream is a projection of the outbox and never the send path; no second listener, no Node service, authenticated polling stays the fallback. Binds Issue #1171 with fourteen invariants, caps and slow-consumer rules, an accessibility contract and a required test list. Documentation only (ADR with Indonesian mirror and ADR index); no route, table, migration, dependency or job is added.
