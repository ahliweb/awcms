---
"awcms": minor
---

ADR-0083: repo ini men-deploy ke SATU environment (production, `awcms.ahlikoding.com`) karena ia template, dan `/` berhenti menjadi 404 — `src/pages/index.astro` melayani halaman landing informasional bertaut `/login`, tanpa query basis data, tanpa enumerasi, dan tanpa skrip klien baru.
