---
"awcms": patch
---

The inventory movements listing and detail now expose `reversedByMovementId` (the reversal that compensated an adjustment, or null), answered by one correlated index probe per row rather than a query per row. `/admin/inventory` hides Reverse once an adjustment has been reversed. The inventory and tax screens also share `blankToNull`, drop their English confirm fallbacks, and the idempotency-key helper records its two memory-only limitations.
