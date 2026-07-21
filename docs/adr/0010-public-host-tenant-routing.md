# ADR-0010 — Host/domain-based public tenant routing (online-public extension)

- **Status:** Accepted
- **Tanggal:** 2026-07-08
- **Pengambil keputusan:** <maintainer>
- **Terkait:** `docs/adr/0009-public-tenant-scoped-routes.md`, `docs/adr/0003-postgresql-rls-multi-tenant.md`, `docs/awcms/deployment-profiles.md` §Profil online, `docs/awcms/18_configuration_env_reference.md` §Public routing, `src/modules/blog-content/README.md` §`/news` (default) vs `/blog/{tenantCode}` (legacy), `.claude/skills/awcms-tenant-domain-routing/SKILL.md`, Issue #556-#561 (epic #555)

## Konteks

ADR-0009 memutuskan rute publik tenant-scoped (`/blog/{tenantCode}/...`,
Issue #540) me-resolve tenant lewat **segmen path eksplisit** yang membawa
`tenant_code`, dan secara eksplisit menolak subdomain/custom-domain per
tenant sebagai _default_ base — karena butuh wildcard DNS/TLS dan
bertentangan dengan topologi LAN-first/offline default AWCMS (doc 18).
ADR-0009 §Alternatif yang dipertimbangkan sudah mencatat kedua alternatif
itu ("subdomain per tenant", "domain custom per tenant") sebagai **valid
sebagai ekstensi opsional untuk deployment online-only** — "bisa jadi ADR
susulan bila dibutuhkan aplikasi turunan tertentu".

Epic #555 ("online public tenant routing, news routes, and tenant domain
management") merealisasikan ekstensi itu: config opsional
`PUBLIC_TENANT_RESOLUTION_MODE` (Issue #556), skema pemetaan
hostname→tenant `awcms_tenant_domains` (Issue #557), module descriptor
`tenant_domain` (Issue #558), resolver host-based
`resolvePublicTenantFromRequest` (Issue #559), dan rute publik baru `/news`
yang tidak membawa segmen `tenantCode` sama sekali (Issue #560). Issue #561
(ADR ini) mendokumentasikan keputusan yang sudah terwujud lewat empat issue
itu, dan menegaskan hubungannya dengan ADR-0009.

## Keputusan

Kami memutuskan untuk menambahkan **mode resolusi tenant berbasis
host/domain** sebagai kapabilitas _tambahan_ untuk rute publik anonim, di
atas (bukan menggantikan) resolusi berbasis path segment yang sudah
diputuskan ADR-0009:

- Mode dipilih lewat env var `PUBLIC_TENANT_RESOLUTION_MODE`
  (`host_default | env_default | setup_default | tenant_code_legacy`,
  Issue #556) — opsional, opt-in per deployment. Tidak diset sama sekali
  (default semua deployment offline/LAN existing) tetap memakai perilaku
  legacy sepenuhnya.
- Saat `host_default`, `resolvePublicTenantFromRequest()` (Issue #559)
  me-resolve tenant dari request `Host`/`X-Forwarded-Host` (hanya kalau
  `PUBLIC_TRUST_PROXY=true` eksplisit) lewat tabel
  `awcms_tenant_domains` (Issue #557), melalui fungsi lookup
  `SECURITY DEFINER` yang sempit (satu tabel, empat kolom
  non-sensitif, `EXECUTE` di-revoke dari `PUBLIC`). **Status:** modul
  `tenant_domain` belum di-port ke repo ini; migrasi lookup ini direncanakan
  saat port dilakukan, dengan nomor migrasi **TBD (≠ `033`, yang kini dipakai
  skema `theming`)**.
  Selain `host_default`, tersedia fallback berjenjang (`PUBLIC_DEFAULT_TENANT_ID`/
  `_CODE`, lalu `awcms_setup_state`) sebelum akhirnya `null` (404
  generik) — lihat `.claude/skills/awcms-tenant-domain-routing/SKILL.md`
  §Resolver untuk urutan lengkap.
- Rute publik baru `/news` (Issue #560) mengonsumsi resolver ini lewat
  `withNewsTenant()` — **tanpa** segmen `tenantCode` di path sama sekali.
  Rute lama `/blog/{tenantCode}` (ADR-0009, Issue #540) **tidak diubah**
  dan tetap memakai `resolvePublicTenantByCode()` (path segment), tidak
  pernah menyentuh resolver host-based ini.
- Mode `tenant_code_legacy`, saat diset eksplisit, membuat resolver
  langsung `null` untuk `/news` (tidak ada tebakan tenant default apa
  pun) — keputusan sadar operator "tetap wajib `tenantCode` eksplisit di
  path", didokumentasikan detail di Issue #560's `SKILL.md` §Keputusan
  `tenant_code_legacy`.

Ini adalah **ekstensi di atas ADR-0009**, bukan penggantinya: kedua
mekanisme resolusi (path segment vs host/domain) hidup berdampingan secara
permanen. `/blog/{tenantCode}` tidak dijadwalkan untuk dihapus.

## Konsekuensi

- **Positif:** Deployment online/public/SaaS dengan domain nyata mendapat
  URL publik yang bersih, SEO-friendly, dan tenant-implisit (`/news/...`,
  tidak membocorkan `tenant_code` di path) tanpa mengubah topologi
  LAN-first/offline default AWCMS sama sekali — deployment yang tidak
  pernah men-set `PUBLIC_*` apa pun tetap identik perilakunya
  (`config:validate` tetap PASS, `/blog/{tenantCode}` tetap satu-satunya
  rute publik yang relevan). Perubahan bersifat murni aditif/opt-in.
- **Negatif/trade-off:** Dua mekanisme resolusi tenant paralel sekarang
  ada untuk konteks publik (path segment vs host mapping) — modul turunan
  yang menambah rute publik baru harus sadar memilih salah satu secara
  eksplisit, bukan mengasumsikan satu mekanisme universal. Mode
  `host_default` menambah permukaan risiko konfigurasi baru:
  `PUBLIC_TRUST_PROXY=true` **wajib** hanya diaktifkan di belakang reverse
  proxy tepercaya yang menimpa (bukan menambahkan/forward) `X-Forwarded-Host`
  — kesalahan konfigurasi proxy di sini bisa membuka tenant spoofing lewat
  header yang dipalsukan klien.
- **Netral:** Ada satu follow-up keamanan yang sudah diidentifikasi dan
  belum diperbaiki — timing side-channel lintas tiga outcome 404
  `withNewsTenant` (tenant tidak resolve / `tenant_code_legacy` / module
  `blog_content` disabled) yang punya biaya latency berbeda-beda, dicatat
  sebagai **wajib diperbaiki sebelum `PUBLIC_TENANT_RESOLUTION_MODE=host_default`
  diaktifkan di production** (lihat `.claude/skills/awcms-tenant-domain-routing/SKILL.md`
  §Follow-up keamanan wajib). Ini tidak memblokir penerimaan ADR ini karena
  `host_default` belum bisa resolve mapping nyata apa pun sampai Issue #562
  (API tenant domain) ada.

### Isolasi tenant tidak berubah, terlepas dari mode routing

Mode resolusi tenant untuk rute publik (path segment vs host/domain) **hanya
menentukan bagaimana `tenant_id` ditemukan** dari request anonim, sebelum
transaksi `withTenant(...)` dibuka. Setelah `tenant_id` resolve — lewat
mekanisme mana pun — **seluruh isolasi data tetap murni berbasis
database/RLS** (ADR-0003): `FORCE ROW LEVEL SECURITY` pada tabel
tenant-scoped, GUC `app.current_tenant_id` fail-closed, dan peran aplikasi
`awcms_app` yang bukan superuser/table-owner. Fungsi `SECURITY DEFINER`
yang direncanakan dipakai resolver host-based (`awcms_resolve_tenant_domain_lookup`,
migrasi TBD saat modul `tenant_domain` di-port — **bukan `sql/033`, yang kini
skema `theming`**) tidak akan melonggarkan RLS di jalur query manapun setelahnya — ia
hanya melakukan satu lookup sempit (`hostname → tenant_id`) yang secara
desain terjadi _sebelum_ tenant context ada, persis simetris dengan
lookup `tenant_code → tenant_id` (juga RLS-free, tabel akar) yang sudah
dipakai `/blog/{tenantCode}` sejak ADR-0009. Menambah mode resolusi baru
tidak pernah berarti menambah cara baru untuk melewati RLS pada data
tenant-scoped mana pun.

## Alternatif yang dipertimbangkan

- **Menjadikan host/domain-based routing sebagai default/satu-satunya
  mekanisme, migrasi penuh dari `/blog/{tenantCode}`** — ditolak: memaksa
  setiap deployment offline/LAN (yang sering tidak punya domain publik
  sama sekali, doc 18 §Topologi LAN-first) untuk bergantung pada DNS/host
  header, bertentangan langsung dengan prinsip LAN-first default AWCMS
  dan dengan Out of Scope epic #555 ("removing legacy `/blog/{tenantCode}`
  routes in the MVP").
- **Redirect otomatis dari `/blog/{tenantCode}` ke `/news` untuk tenant
  yang sudah punya domain mapping** — ditolak untuk lingkup ADR ini: rute
  lama dan baru memakai konteks resolusi tenant yang berbeda (path segment
  eksplisit vs host implisit); redirect otomatis butuh keputusan produk
  tambahan (mis. apakah tenantCode di URL boleh "bocor" sesaat sebelum
  redirect) di luar cakupan issue #561 yang eksplisit docs-only. Dicatat
  sebagai kemungkinan issue lanjutan, bukan bagian dari keputusan ini.
- **Subdomain per tenant otomatis (mis. `{tenantCode}.platform.example.com`)
  tanpa tabel mapping eksplisit** — ditolak: tidak mendukung custom domain
  pelanggan (`blog.pelanggan-a.com`) yang menjadi salah satu motivasi utama
  epic #555, dan tetap mewajibkan wildcard TLS yang sama seperti alternatif
  yang sudah ditolak ADR-0009. Tabel `awcms_tenant_domains` (Issue
  #557) mendukung keduanya (subdomain **dan** custom domain) lewat
  `domain_type`, jadi dipilih sebagai mekanisme mapping yang lebih umum.
