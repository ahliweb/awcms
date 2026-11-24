---
"awcms": patch
---

test(omes-control): DB-backed FORCE RLS probes for the worker-ingestion tables `awcms_omes_servers`, `awcms_omes_enrollments`, `awcms_omes_operation_requests`, `awcms_omes_jobs`, `awcms_omes_worker_nonces` and `awcms_omes_worker_results` (run as the real `awcms_app` login), tenant-substitution tests for the worker `result` and `heartbeat` routes, and validation of a real `job_available` poll body against the pinned `worker-poll.response` schema (Issue #1185, part). Tests and README only; no runtime or contract change.
