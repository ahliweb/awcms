---
"awcms": patch
---

fix(openapi): contract hygiene, descriptive only (Issue #1389). `BookingPolicy.policy` now really declares its ten fields under `properties` (they hung one indent level too high, so the object declared none) and marks them `type: [X, "null"]`, matching what `GET/PUT /api/v1/booking/policy` returns. 19 schema locations in 12 module fragments used `nullable: true` without a `type` in the `openapi: 3.1.0` document, where `nullable` is not a keyword and was ignored; each is now `oneOf: [<the schema>, { type: "null" }]`. No runtime change: handlers already returned these shapes. `tests/openapi-contract-hygiene.test.ts` fails if either defect returns; the broader ajv-based contract lint stays with Issue #1390.
