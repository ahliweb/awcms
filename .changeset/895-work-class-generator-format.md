---
"awcms": patch
---

fix(tooling): make db:work-class:generate output prettier-stable

The generator now uses prettier's API to format the JSON output before writing it, ensuring that both `bun run lint` and `bun run db:work-class:check` pass even when a route file declares multiple work classes. This fixes the issue where arrays of work classes were formatted multi-line by the generator but collapsed to a single line by prettier.
