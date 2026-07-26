---
name: awcms-comments
description: Modul comments SUDAH di-port ke repo ini (dari awcms-micro Issue #271 / ADR-0032, di sini ADR-0041; migrasi `sql/066` schema + `sql/067` permission, Gelombang-1 `docs/awcms/absorb-awcms-micro-roadmap.md`). Komentar moderation-first per tenant di atas resource TERBIT & publik — `type: domain`, deps `[tenant_admin, identity_access, module_management, profile_identity, domain_event_runtime]` (tiga terakhir ditambahkan #251 — sudah di-import sebelumnya tanpa dideklarasikan), 7 tabel `awcms_comments_*` ENABLE+FORCE RLS, seam kontribusi `commentableResources` (`MODULE_CONTRACT_VERSION` 2.3.0), 10 rute `/api/v1/comments/*` (6 di antaranya PUBLIK tak-terautentikasi), layar admin `/admin/comments`, job `bun run comments:retention`, gate `bun run comments:resources:check`. Gunakan saat menambah tipe resource yang boleh dikomentari, mengubah kebijakan/moderasi/anti-abuse, atau mengerjakan follow-up (dispatcher notifikasi balasan, komponen form publik, penegakan Turnstile). PERINGATAN: ini permukaan TULIS publik tak-terautentikasi — baca §Tulang punggung keamanan sebelum menyentuh apa pun.
---

# AWCMS — Comments (moderation-first)

Ikuti `src/modules/comments/README.md` dan
[ADR-0041](../../../docs/adr/0041-comments-module-admission.md). Modul ini
**ada dan bisa dipanggil** di repo ini.

## Hal pertama yang harus dipahami

Ini **permukaan TULIS publik yang tak terautentikasi**. Enam dari sepuluh rute
tidak punya sesi sama sekali, dan itu **disengaja** (pembaca artikel yang
berkomentar memang tak punya akun). Yang menahannya bukan autentikasi, jadi
sebelum mengubah apa pun di jalur publik, tanyakan: _apa yang menghalangi orang
asing anonim memakai ini untuk menyimpan markup, meng-enumerasi konten belum
terbit, atau membanjiri antrean?_

Enam operasi publik itu terdaftar eksplisit di `ALLOWED_PUBLIC_OPERATIONS`
(`scripts/api-spec-check.ts`) dengan alasannya. **Menambah operasi publik ketujuh
akan memerahkan `api:spec:check`** sampai kamu menuliskan pembenarannya di situ —
itu gerbang review yang disengaja, bukan gangguan.

## Arah panah: JANGAN dibalik

`comments` bergantung pada **Core saja**. Ia **tidak pernah** mengimpor modul
konten.

Modul konten **MENDEKLARASIKAN** resource yang boleh dikomentari lewat
`ModuleDescriptor.commentableResources` — data murni (nama tabel/kolom yang
di-review + `publicationFilter` deklaratif). `comments` menemukannya lewat
`listModules()`.

**Menambah tipe resource baru = satu deklarasi di `module.ts` modul itu
sendiri, nol perubahan di `src/modules/comments/`.** Kalau kamu merasa perlu
mengedit `comments` untuk mendukung tipe konten baru, berhenti — kemungkinan
besar kamu sedang membalik panahnya.

Jangan pakai capability `provides`: penyedia jamak memang diharapkan, dan yang
kedua akan men-trip `capability_provider_conflict`.

`src/lib/comments/commentable-resources.ts` adalah composition root — satu-satunya
tempat yang boleh memanggil `listModules()`. Semua isi `domain/` dan
`application/` menerima descriptor sebagai **parameter**.

## Tulang punggung keamanan (jangan diregresi)

1. **Batas publikasi.** Komentar hanya diterima/ditampilkan terhadap resource
   yang lolos `publicationFilter` milik modul pemiliknya. Permukaan komentar
   **tidak pernah** jadi sumber otorisasi untuk resource di bawahnya.
2. **Simpan teks polos, escape saat render.** Body **tidak pernah** disimpan
   sebagai HTML. Jangan tergoda menambah "sedikit markup yang diizinkan" — begitu
   ada allow-list sanitizer, kelas bug XSS tersimpan kembali terbuka. Autolink
   http(s) saja, href dan teks tampak sama-sama ter-escape.
3. **Tanpa oracle.** Respons submit publik **seragam**. Kalau kamu menambah kode
   error yang membedakan "diblokir blocked-term" dari "diterima menunggu
   moderasi", kamu baru saja membangun enumerator blocked-term. Operasi
   author-bound mengembalikan **404, bukan 403**.
4. **Anti-abuse fail-closed.** Dengan lantai waktu aktif, pengukuran yang hilang
   dihitung `too_fast`. Membalik itu jadi "izinkan kalau tak ada token" membuat
   seluruh lantai waktu bisa dilewati dengan menghapus satu field.
5. **PII diminimalkan.** Email penulis hanya sha256 + mask. IP/user-agent hanya
   hash ber-salt tenant. **Jangan pernah** menambahkan kolom yang menyimpan
   alamat mentah.
6. **RLS.** Ketujuh tabel `ENABLE` **dan** `FORCE`. Tabel baru wajib keduanya.

## Jebakan yang sudah ditemukan (jangan diulang)

- **Cursor keyset.** Kedua jalur list memakai cursor TEKS presisi penuh
  (`to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')`) + tiebreak
  `(created_at, id)`. `timestamptz` presisi mikrodetik, `Date` JS milidetik,
  driver FLOOR — cursor ber-`Date` melewatkan setiap baris yang berbagi
  milidetik yang sama. Jangan "sederhanakan" kembali jadi `Date`.
- **`published_at` tidak pernah dihapus.** Hanya di-set saat approve
  (`coalesce`). awcms-micro me-NULL-kannya tiap transisi non-approve, yang
  menghapus jejak bahwa komentar ter-arsip pernah terbit.
- **Grant worker.** Menambah `GRANT ... TO awcms_worker` di migrasi comments
  **wajib** diikuti entri identik di `WORKER_ROLE_GRANTS`
  (`scripts/security-readiness.ts`). Ada test yang membaca teks migrasi dan
  membandingkannya — sudah dibuktikan merah. Worker **tidak boleh** punya
  DELETE/INSERT pada `awcms_comments_comments`: retensi meng-anonimkan di
  tempat, dan riwayat moderasi append-only harus tetap menunjuk baris nyata.
- **Descriptor kembar `blog_content`.** `searchSources` dan
  `commentableResources` mendeklarasikan `publicationFilter` yang **sama
  persis**. Ada test yang menegakkannya (sudah dibuktikan merah saat di-drift).
  Kalau kamu mengubah satu, ubah keduanya.
- **`labelKey` navigasi kini DIRENDER.** Sidebar admin dibangun dari
  `listModules()` lewat `module-management/domain/sidebar-menu.ts`; tidak ada
  lagi daftar statis untuk disinkronkan. `admin.layout.nav_comments` di-resolve
  lewat `SIDEBAR_LABELS`. `group: "content"` dibuang dari descriptor karena
  `DEFAULT_MODULE_TYPE` menempatkan `comments` di `engagement` dan peta itu
  menang — nilai yang tak pernah berlaku lebih buruk dari tidak ada nilai.

## Perintah

```bash
bun run comments:resources:check   # gate registry (bagian dari `bun run check`), murni tanpa DB
bun run comments:retention         # sweep anonymize + purge langganan belum-terkonfirmasi
```

## Belum ada (jangan klaim ada)

- **Dispatcher notifikasi balasan.** Event terbit
  (`awcms.comments.reply.created`, `awcms.comments.comment.approved`);
  consumer email yang me-resolve penerima terenkripsi dan mengirim **belum
  ditulis**.
- **Komponen form komentar publik.** API lengkap; pustaka `src/components/ui/`
  belum ada (baris Gelombang-0 roadmap yang masih terbuka).
- **Penegakan Turnstile.** `turnstileEnabled` tersimpan di settings tapi
  **belum** dipanggil di jalur submit. Saat diwiring, verifikasinya wajib di
  LUAR transaksi DB (ADR-0006).

## Skill terkait

`awcms-new-endpoint`, `awcms-abac-guard`, `awcms-idempotency`,
`awcms-audit-log`, `awcms-sensitive-data` (hash/mask identifier),
`awcms-new-migration` (grant worker + RLS FORCE), `awcms-data-lifecycle`
(tiga descriptor retensi modul ini), `awcms-site-search` (preseden seam
descriptor yang sama), `awcms-blog-content` (penyedia descriptor pertama).
