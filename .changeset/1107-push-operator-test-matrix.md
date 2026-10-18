---
"awcms": patch
---

Push delivery operator test matrix, runbook and mock-provider integration coverage (Issue #1107). No runtime behaviour change: adds `docs/awcms/push-notifications-test-matrix.md` (EN/ID) and 13 integration tests that drive the real web-push adapter through a scripted push service (both payload formats, retry/backoff, 403/404/410, tenant isolation, revoke, worker crash recovery, concurrent workers). Real-device UAT rows are recorded as pending. Code comments now state that `sent` means the push service accepted the message, not that a device displayed it.
