---
"awcms": patch
---

test(booking): the allocation soak now fails with full diagnostics (offending row ids, ranges, xmin/xmax, created/released timestamps, reservation, txid snapshot, server version) via a reusable post-hoc overlap invariant query (#1087). No allocator or schema change.
