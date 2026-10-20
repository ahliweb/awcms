---
"awcms": patch
---

Govern the technology choice per product surface (ADR-0146, Proposed; refines ADR-0055 and ADR-0070). Every admin surface and every public web surface stays Astro; persona apps (customer, courier, driver, partner, warehouse and field staff) prefer LynxJS + ReactLynx as a candidate in their own consumer repos, as clients of the public API contracts, after a proof-of-concept gate. Adds `scripts/lib/product-surface-policy.ts` (surface table and `classifySurface`) and `tests/product-surface-policy.test.ts`, which pins the seven issue scenarios, fails if the ADR decision table and the module drift, and fails if a `@lynx-js/*` dependency, an import from `@lynx-js/` under `src/`, or a `lynx.config.*` enters this repository. No runtime, API, schema or dependency change.
