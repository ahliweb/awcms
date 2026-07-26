---
"awcms": minor
---

Tutup empat temuan analisis graph: wire resolusi asset theming, lengkapi
deklarasi permission `email`, jujurkan graf dependensi lintas-modul, dan
tambahkan gate batas modul yang selama ini SUDAH DIASUMSIKAN ADA.

**Logo tema akhirnya tampil.** `src/lib/theming/theme-media.ts` mengembalikan
map kosong tanpa syarat. Itu jujur saat ditulis — ADR-0034 Fase 3 mem-port
`theming` lebih dulu dan `media_library` belum ada — tapi header-nya tetap
berkata begitu setelah ADR-0036 mendaratkan modulnya, sehingga no-op itu terbaca
sebagai desain, bukan wiring yang belum selesai. Akibatnya tak pernah tercatat:
tenant mengunggah logo, id-nya tersimpan dan valid, dan `PublicThemeLayout`
selamanya merender fallback nama-tema. Kini resolusi lewat `MediaLibraryPort`
— capability yang sama yang sudah dikonsumsi `blog_content` dan `news_portal`.
Slot yang tidak resolve tetap DIHILANGKAN, bukan melempar: halaman tema publik
tidak boleh 500 karena satu id asset basi. `theming` sekarang mendeklarasikan
`capabilities.consumes` untuk `media_library`.

**`email` mendeklarasikan 12 permission-nya**, verbatim dari seed `sql/014`.
Ia satu-satunya dari 21 modul yang belum, sehingga seluruh barisnya permanen
tampil `orphaned` di `GET /api/v1/modules/email/permissions` — false positive
menetap yang melatih pembaca mengabaikan laporan drift. Kini 21/21.

**Enam edge lintas-modul tak-terdeklarasi dijujurkan.** `seo_distribution`,
`site_search`, dan `comments` meng-import modul yang tidak ada di descriptor-nya;
semuanya kini dideklarasikan, tanpa satu pun cycle.
`domain_event_runtime -> reporting` TIDAK bisa dideklarasikan — `reporting`
sudah mendeklarasikan arah sebaliknya, jadi mendeklarasikannya = cycle — dan
menjadi satu-satunya pengecualian tercatat, dengan alasan yang bisa dibantah
reviewer.

**`tests/module-boundary.test.ts`.** `capability-contract-versions.ts` selama
ini membenarkan capability tanpa versi dengan kalimat "a source-boundary test
(`tests/unit/module-boundary.test.ts`) is enough to keep provider and consumer
in sync". **Berkas itu tidak pernah ada di repo ini** — kalimatnya ikut ter-port
dari awcms-mini, test-nya tidak. Jaring pengaman yang dinyatakan untuk seluruh
model capability itu imajiner. Sekarang nyata: tiap import lintas-modul wajib
dideklarasikan sebagai dependency, sebagai capability consumption, atau
dikecualikan eksplisit dengan alasan.
