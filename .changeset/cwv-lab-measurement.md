---
"awcms": minor
---

Core Web Vitals kini diukur di LAB — Opsi D ADR-0067, nol data pengunjung.

Spec baru `tests/e2e/cwv-lab.e2e.ts` (harness E2E Playwright yang sudah ada,
bukan harness kedua) mengukur **LCP** dan **CLS** halaman `/login` via
`PerformanceObserver` ber-`buffered: true`, dengan CLS dihitung per definisi
session-window CWV. Ambang kelulusan = ambang "baik" CWV (LCP ≤ 2500 ms,
CLS ≤ 0,1) — sebagai batas LAB satu mesin: detektor regresi, BUKAN p75
lapangan. INP sengaja tidak diukur/diklaim (tanpa interaksi nyata ia tidak
bermakna di lab).

Gerbangnya env-gated (`E2E_CWV_LAB=1`, dinyalakan job CI `e2e-smoke`); saat
env tidak diset ia MENCETAK pernyataan skip eksplisit, dan saat berjalan LCP
yang tidak terekam adalah kegagalan — gerbang ini tidak pernah hijau senyap.
Script baru: `bun run perf:cwv:lab`. Tidak ada skrip klien, endpoint, tabel,
atau sentuhan pada `visitor_analytics`; keputusan RUM (Opsi B) tetap milik
pemilik produk — status ADR-0067 tidak berubah.
