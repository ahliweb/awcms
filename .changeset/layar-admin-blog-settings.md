---
"awcms": minor
---

feat(admin): layar `/admin/blog-settings` — pengaturan blog berhenti hanya bisa diubah lewat `curl`

`GET`/`PATCH /api/v1/blog/settings` mendarat lengkap bersama Issue #543 —
ter-guard di dalam `withTenant`, ter-audit, tervalidasi — dan punya **nol
konsumen UI**. `rssEnabled` dan `sitemapEnabled` menentukan apakah feed dan
sitemap tenant dilayani sama sekali, dan sampai sekarang satu-satunya cara
mengubahnya adalah `curl`. Kapabilitas yang tak bisa dijangkau operator adalah
kapabilitas yang sebenarnya tidak dimiliki deployment.

**Ini BUKAN layar setting modul, dan bedanya load-bearing.**
`/admin/modules/blog_content` (Module Management, generik) menulis
`awcms_module_settings` — override per-tenant atas `settings.defaults`
descriptor, yang hari ini tinggal `legacyTenantRouteEnabled`. Layar ini menulis
`awcms_blog_settings`, tabel berbeda dengan permission berbeda
(`blog_content.settings.*`) dan endpoint berbeda. README modul mencatat
pemisahan dua-store itu sebagai keputusan.

Risikonya karena itu bukan store yang hilang, melainkan **kontrol yang
terduplikasi**: dua layar yang sama-sama tampak menawarkan "pengaturan blog"
sambil menulis baris yang berbeda. Layar ini karena itu **tidak merender apa pun**
dari store setting modul dan hanya menautkan ke layar generiknya. Field yang
dicerminkan dua layar adalah field yang basi diam-diam, karena layar yang diedit
belakangan menang dan tak satu pun mengatakannya.

Dua field endpoint sengaja TIDAK ada di form, dan disebutkan namanya supaya
absennya terbaca sebagai keputusan: `contentQualityChecklistPolicy` (peta
override severity bersarang — menaruh kebijakan pemblokir-publish di balik
textarea JSON tanpa umpan balik per-rule bukan kontrol yang layak) dan
`socialPreviewFallbackImageMediaId` (mengetik UUID bukan media picker;
`/admin/media` sudah memiliki pemilihan objek, dan field id mentah justru
mengundang menempel id milik tenant lain yang endpoint-nya tolak sebagai galat
validasi yang tak bisa ditindaklanjuti operator).

Satu permission menggerbangi seluruh field (`settings.configure`) karena
`sql/036` tidak men-seed permission tulis per-field — mengarang gerbang per-field
di UI akan menyiratkan wewenang yang tak akan dihormati `authorizeInTransaction`
mana pun.

Entri navigasi digerbangi `settings.read`, bukan salah satu dari empat entri
`blog_content` yang sudah ada: operator bisa memegang authoring blog tanpa
memegang saklar discovery tenant. `tests/admin-blog-page-contract.test.ts`
mematok jumlah entri navigasi persis supaya tiap kedatangan layar baru menjadi
baris yang diedit dengan sengaja — dan ia memang memerah saat layar ini mendarat,
lalu dinaikkan dari empat ke lima.
