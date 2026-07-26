---
"awcms": patch
---

Define the `src/lib` boundary and extend the module-boundary gate to `src/pages`
(ADR-0043).

`src/lib` had become a second, ungated module system: four namespaces (`seo`,
`theming`, `comments`, `search`) carried the name of an existing module and held
that module's code, and `seo_distribution` referred UP into `src/lib/seo` along
a path the DAG validator cannot see. `src/lib` is now technical infrastructure
with no domain name; module presentation/delivery code lives in
`src/modules/<m>/presentation/`. Eight files moved with `git mv`; no behaviour,
API, migration, event, permission or registry change.

`modules:dag:check` fails on a `src/lib/<x>/` namespace that collides with a
module key — exactly or via a registered domain alias (without aliases, two of
the four real cases would have passed). `src/lib/logging/` is a recorded
exception, and the test proves it is DETECTED and merely excused.

`tests/module-boundary.test.ts` now also covers `src/pages` (38k lines,
previously scanned by nothing), attributing each route to its owner via
`api.routes`. That surfaced four hidden edges: three are now declared
(`theming` -> `module_management`, `visitor_analytics` -> `data_lifecycle` and
-> `module_management`) and one was removed instead — `extractReferrerDomain`
moved to `_shared`, because a pure string-to-hostname function should not make
SEO telemetry depend on the analytics module being enabled.
