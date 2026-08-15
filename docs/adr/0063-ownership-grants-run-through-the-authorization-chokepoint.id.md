🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0063-ownership-grants-run-through-the-authorization-chokepoint.md)

<!-- i18n-source-hash: sha256:5666bbae643259da7866a1fa803ca407260a5eca8fadd47d9add22646885ee75 -->

# ADR-0063 — Grant berbasis kepemilikan lewat chokepoint, bukan menggantikannya

- **Status:** Accepted
- **Tanggal:** 2026-08-04
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0053](0053-platform-scoped-permissions.md) (gerbang platform-scope di chokepoint), [ADR-0060](0060-business-scope-hierarchy-provided-by-tenant-admin.md) (business-scope facts di chokepoint), [ADR-0057](0057-blog-page-lifecycle.md) §F + [ADR-0058](0058-unenforced-permissions-disposition.md) (gerbang cakupan permission — dan batasnya), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (kredensial mesin tak pernah mengotorisasi), [ADR-0062](0062-skills-are-gated-against-the-code-they-describe.md) (preseden: aturan yang tak tertulis di skill tidak diikuti)

## Konteks

### 1. Tiga handler memutuskan permission di luar chokepoint

`authorizeInTransaction` adalah satu-satunya tempat empat lapisan ini dievaluasi:
evaluator ABAC (`evaluateAccess`), gerbang platform-scope (ADR-0053),
business-scope facts (ADR-0060), dan SoD aksi-waktu (#181).

Tiga handler tidak memanggilnya dan menyusun keputusannya sendiri dari
`fetchGrantedPermissionKeys` + aturan domain:

- `PATCH /api/v1/blog/posts/{id}`
- `POST /api/v1/blog/posts/{id}/submit-review`
- `PATCH /api/v1/blog/pages/{id}`

Akibatnya konkret: **sebuah tenant yang menulis policy ABAC `deny` atas
`blog_content.posts.update` mendapati policy-nya dihormati di sebagian rute dan
diabaikan di tiga rute ini** — tanpa error, tanpa test merah, tanpa gerbang
merah.

### 2. Ketiganya BUKAN kelalaian — chokepoint memang tidak bisa menampungnya

Ini bagian yang mengubah bentuk keputusan.

Ketiga handler menegakkan aturan yang sengaja ada di dokumen produk (#538): **penulis
boleh menyunting kontennya sendiri yang belum terbit MESKIPUN tidak memegang
`blog_content.posts.update`.** Itu sumbu otorisasi yang **tidak bisa diekspresikan
katalog permission** — ia properti relasi subjek↔resource, bukan properti role.

`authorizeInTransaction` mengembalikan `denied` **sebelum** aturan domain mana pun
sempat dikonsultasi. Jadi menaruhnya di depan `evaluatePostUpdateAccess` akan
**menghapus jalur penulis**: seorang penulis tanpa permission ditolak di
chokepoint, dan fitur yang dispesifikasikan hilang.

Dengan kata lain: ketiga rute itu bukan memilih jalan pintas. **Mereka satu-satunya
jalan yang tersedia.** Cacatnya ada di seam chokepoint, bukan di disiplin
penulisnya — dan memperbaikinya dengan "panggil saja chokepoint" adalah regresi
fungsional yang akan lolos review karena terlihat seperti pengetatan keamanan.

### 3. Koreksi terhadap asesmen yang memicu ADR ini

[`../awcms/repo-assessment-2026-08-04.md`](../awcms/repo-assessment-2026-08-04.md) §2
menulis temuan ini sebagai **satu** rute menyimpang, dengan
`PATCH /api/v1/blog/posts/{id}` sebagai **contoh pola yang BENAR** ("memanggil
`authorizeInTransaction` lebih dulu, lalu `evaluatePostUpdateAccess`").

**Itu salah.** Berkas `blog/posts/[id].ts` memanggil `authorizeInTransaction` dua
kali — di `GET` (baris 83) dan di `DELETE` (baris 431) — sementara `PATCH` di
berkas yang sama tidak sama sekali. Pembacaan tingkat-BERKAS menggabungkan
ketiganya jadi satu alur dan menyimpulkan kepatuhan yang tidak ada.

Kelasnya sama persis dengan yang ADR-0058 §1 catat dan ADR-0059 ulangi: sebuah
dugaan ditulis sebagai temuan, lalu tersalin ke dokumen sebagai keputusan. Kali
ini korbannya asesmen itu sendiri. Asesmen sudah dikoreksi di PR yang sama dengan
ADR ini, dan gerbang di §Keputusan **mengiris per-HANDLER justru karena itulah
kesalahan yang benar-benar terjadi**.

### 4. Kenapa gerbang cakupan permission tidak melihatnya

`access:permissions:enforcement:check` bertanya **"apakah permission ini punya
penegak?"**. `blog_content.posts.update` punya — `GET`/`DELETE` di berkas yang
sama, dan rute lain. Ia tidak pernah bertanya **"apakah SETIAP situs penegakan
memakai chokepoint?"**. Pengulangan pelajaran PR #351: gerbang cakupan dan
kebenaran situs penegakan adalah dua pertanyaan berbeda, dan sebuah kontrol bisa
lulus yang pertama sambil salah di yang kedua.

## Keputusan

### §A — `ownershipGrant`: MELEBARKAN, bukan MEMOTONG

`authorizeInTransaction` menerima opsi baru:

```ts
options?: { ownershipGrant?: { granted: boolean; reason: string } }
```

Saat `granted`, guard **menambahkan permission key yang diminta ke himpunan yang
dievaluasi** — lalu menjalankan `evaluateAccess` seperti biasa. Ia tidak
mengembalikan allow lebih awal, tidak melewati satu pun lapisan.

Konsekuensinya persis yang diinginkan: tenant isolation, ABAC (termasuk `deny`
eksplisit), business-scope, dan SoD **tetap bisa menolak**. Kepemilikan hanya
menjawab "apakah subjek ini boleh dianggap memegang permission-nya", bukan
"apakah aksi ini boleh".

**Kredensial mesin dikecualikan.** Ia MENGAUTENTIKASI dan tak pernah
MENGOTORISASI (ADR-0049 §3), jadi token build yang diarahkan ke akun seorang
penulis tidak boleh mewarisi kepemilikan penulis itu.

**Decision log menandai allow berbasis kepemilikan** (`ownership_grant:<reason>`).
Tanpa itu barisnya terbaca identik dengan allow RBAC, dan auditor yang bertanya
"siapa yang bisa melakukan ini, dan kenapa" mendapat jawaban salah untuk
satu-satunya kasus yang jawabannya bukan "sebuah role memberikannya". DENY tidak
pernah dilabeli ulang.

### §B — Gerbang `access:chokepoint:check`, di-iris per HANDLER

Setiap handler yang memanggil `fetchGrantedPermissionKeys` wajib juga melewati
`authorizeInTransaction`/`defineTenantRoute`, atau terdaftar sebagai pengecualian
ber-alasan berkunci `<berkas>#<METHOD>`.

**Per-handler, bukan per-berkas, adalah keputusan yang menanggung beban** — §3 di
atas adalah buktinya bahwa pembacaan per-berkas gagal justru pada kasus nyata.
Kunci ber-METHOD juga memastikan sebuah pengecualian tak pernah melebar ke
handler tetangga di berkas yang sama, yang persis cara cacat aslinya bersembunyi.

Dua pengecualian, keduanya diverifikasi:

- `auth/login.ts#POST` — **pra-autentikasi**: belum ada subjek untuk diotorisasi.
- `access/evaluate.ts#POST` — **introspeksi diri**: memantulkan keputusan
  `evaluateAccess` untuk permintaan CALLER SENDIRI dan memanggil evaluator yang
  sama secara langsung, jadi ABAC **diterapkan**, bukan dilewati.

Pengecualian yang **mati** (handler-nya tak lagi bypass, atau tak ada lagi) ikut
dilaporkan — aturan yang sama yang ADR-0058 dan ADR-0062 pakai.

## Konsekuensi

**Yang didapat.** Nol handler memutuskan permission di luar chokepoint. Policy
ABAC sebuah tenant kini berlaku seragam. Aturan kepemilikan tetap hidup, dan kini
**terbaca di decision log sebagai apa adanya**.

**Yang dibayar.** Satu opsi baru di spine keamanan — permukaan yang harus
dilindungi. Perlindungannya: guard tidak boleh MEMOTONG, dan itu ditegakkan
sebagai kontrak atas teks sumber guard itu sendiri, karena implementasi salahnya
(`if (ownership.granted) return { allowed: true }`) satu baris, lolos setiap test
perilaku `evaluateAccess`, dan tak akan pernah terlihat oleh test evaluator mana
pun.

> **Satu klaim yang sempat ditulis di test ADR ini juga SALAH, dan mutasi yang
> membantahnya.** Draf pertama menyatakan keamanannya berasal dari urutan — "ABAC
> dicocokkan SEBELUM cek key RBAC, jadi kepemilikan tak bisa mengalahkan deny".
> Dimutasi dengan menaikkan cek RBAC ke atas blok ABAC: **test tetap hijau**,
> karena `deny` mengembalikan hasil di kedua urutan. Urutannya tidak relevan.
> Yang menjadi properti sesungguhnya adalah **tidak memotong**, dan itulah yang
> sekarang diuji — termasuk di tingkat sumber guard.

**Nol migrasi, nol permission baru, nol perubahan OpenAPI.** Perilaku yang
berubah hanya satu arah: aksi yang sebelumnya lolos karena melewati ABAC kini
bisa ditolak policy tenant — yang memang tujuannya.
