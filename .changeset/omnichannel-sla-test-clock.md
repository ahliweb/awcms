---
"awcms": patch
---

test(omnichannel_inbox): the SLA integration test's last inbound is stamped after the real clock instead of a fixed `2026-11-17T04:00Z`. The response it follows is recorded at the real "now", and the projector rightly ignores an inbound at or before `answered_through`, so the fixed date only worked while it was still in the future and turned `Integration tests` red for every PR once the wall clock passed it. Test-only; no runtime change.
