---
"awcms": patch
---

Rate limit permukaan auth publik mendapat plafon per-SUMBER yang kuncinya tidak
bisa dipilih penyerang (#447).

Tujuh rute tak-terautentikasi mengunci bucket-nya pada `${clientIp}:${tenantId}`,
dan `tenantId` adalah header `x-awcms-tenant-id` mentah — tidak divalidasi, tidak
dicari. Pemeriksaan pertama terjadi di dalam `withTenant`, jauh setelah limiter
memutuskan. Jadi kunci bucket-nya **dipilih penyerang**: UUID acak yang berbeda
per request memberi bucket segar setiap kali, dan limiternya tidak mengikat sama
sekali — bukan "N kali lebih longgar" seperti yang ditulis #430.

Yang membuatnya mahal, bukan sekadar berantakan: `verifyPasswordOrDummy`
menjalankan argon2id `m=64MB` bahkan saat identifier tidak resolve (Issue #147,
dan itu benar — ia yang menghentikan endpoint ini jadi oracle enumerasi). Tiap
request yang lolos berharga 64 MiB plus CPU-nya. Docblock limiternya sendiri
menyebut skenario itu sebagai hal yang ia ada untuk mencegahnya.

**Bukan** diperbaiki dengan memvalidasi header lebih awal: UUID acak adalah UUID
yang valid, dan memeriksa keberadaan tenant sebelum kerja password justru
memasang oracle enumerasi TENANT — persis selisih waktu yang desain dummy-hash
hilangkan untuk identitas. Yang mengikat adalah plafon yang kuncinya tidak bisa
dipilih: satu bucket per SUMBER (`clientIp` saja), diperiksa berdampingan dengan
bucket per-tenant yang sudah ada, **di dalam satu fungsi** supaya rute tidak bisa
mengambil separuhnya. Plafon sumber diperiksa lebih dulu: menghabiskan slot
per-tenant untuk request yang akan ditolak plafon sumber akan membiarkan lalu
lintas penyerang mengisi bucket tenant nyata — mengubah bypass menjadi DoS
terhadap pengguna tenant itu.

`AUTH_SOURCE_RATE_LIMIT_MAX` (default 60) wajib ≥ `AUTH_LOGIN_RATE_LIMIT_MAX`,
ditegakkan `config:validate`. Itulah yang membuat perubahan ini **terbukti inert
pada deployment satu tenant** — di sana bucket per-tenant selalu penuh lebih
dulu — dan karenanya bisa mendarat tanpa flag.

Rute ketujuh (`sso/[providerKey]/start.ts`) tidak ada di daftar issue-nya; test
strukturalnya yang menemukannya setelah enam pertama dikonversi tangan.
