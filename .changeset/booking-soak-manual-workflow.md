---
"awcms": patch
---

ci(booking): add a manual-only `Booking soak (manual)` workflow (`.github/workflows/booking-soak.yml`, `workflow_dispatch` with an `iterations` input of 1-500, read-only permissions, the same pinned actions and Bun 1.4.4 setup as `ci.yml`) that loops the booking "mixed soak" integration test against `postgres:18.4` and uploads the log of every failing iteration (the existing `overlappingLiveAllocations` dump: ids, occupied ranges, xmin/xmax, txid snapshot, server version) plus a summary as an artifact. Diagnostic for #1087 (one unreproduced CI observation of two live overlapping allocations despite `awcms_booking_resource_allocations_time_excl`); it is not a gate and is never triggered by push, pull request or schedule. No runtime, schema or allocator change; no migration.
