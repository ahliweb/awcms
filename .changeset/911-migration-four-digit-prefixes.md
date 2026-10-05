---
"awcms": minor
---

feat(db): `db:migrate` accepts three- or four-digit migration prefixes (`NNN_` or `NNNN_awcms_<area>_<description>.sql`) and applies them in numeric order of the prefix, with the full name as tie-break (#911, ADR-0130). Upstream keeps `001`–`899`; `1000`+ is for derived applications whose reserved band ran out. Every existing three-digit sequence keeps its byte-identical order, and the gate loader (`scripts/lib/migrations.ts`) folds in the same order the runner applies.
