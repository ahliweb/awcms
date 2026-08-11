---
"awcms": patch
---

`config:env:coverage:check` kini melihat env yang dibaca lewat alias `process.env`, bukan hanya `process.env.X` — 53 → 173 variabel terlihat, dan 26 variabel deployment nyata (termasuk seluruh `REDIS_*`) ditambahkan ke `.env.example`.
