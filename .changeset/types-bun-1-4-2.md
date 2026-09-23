---
"awcms": patch
---

chore(deps-dev): bump @types/bun from 1.4.0 to 1.4.2

Type definitions only — dev-time, erased at build, nothing shipped. The bump lines the
types up with the Bun version the CI pins (`1.4.2`), which is where a drift between the
two would otherwise show up as typecheck errors against APIs the running Bun already
has.
