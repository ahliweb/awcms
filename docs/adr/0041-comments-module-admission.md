# ADR-0041 — Admission `comments` (Official Optional Module): komentar moderation-first di atas resource terbit lewat commentable-resource descriptor, DAG-safe inward

- **Status:** Accepted
- **Tanggal:** 2026-07-25
- **Pengambil keputusan:** @ahliweb
- **Mengadaptasi:** awcms-micro `src/modules/comments/` + ADR-0032 (issue #271, epic #261 Gelombang 2; di awcms-micro migrasinya bernomor 089 — penomoran repo itu, bukan repo ini) ke basis `awcms`. Di sini skema mendarat di `sql/066` dan seed permission di `sql/067`.
- **Terkait:** ADR-0040 (`site_search` — preseden LANGSUNG untuk seam descriptor-list dan adaptasi `:tenantCode`), ADR-0038/0039 (`seo_distribution` — preseden kontribusi INWARD), ADR-0037 (`data_lifecycle`, tiga tabel modul ini di-register ke sana), ADR-0013 §1/§6 (modul tidak menulis ke tabel modul lain), ADR-0009 (rute publik tenant-scoped berbasis `tenantCode`), ADR-0006 (provider eksternal di luar transaksi), ADR-0035 (program penyerapan awcms-micro), [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) §Gelombang 1.

## Konteks

Basis ini punya konten publik (`blog_content`, rute `/blog/{tenantCode}/*`) tetapi **tidak punya jalur balik dari pembaca**. Setiap situs publik pada akhirnya membutuhkannya, dan kalau kebutuhan itu dipenuhi ad hoc per modul konten, tiap modul akan menumbuhkan tabel komentar, antrean moderasi, dan aturan anti-abuse-nya sendiri — drift lintas-modul yang persis dibalik oleh ADR-0036 (media) dan ADR-0038 (SEO).

Yang membedakan komentar dari `site_search`: **komentar adalah permukaan TULIS publik yang tak terautentikasi**. Itu menggeser pertanyaan desain dari "siapa yang memiliki indeks" menjadi "apa yang menahan permukaan tulis anonim supaya tidak jadi vektor XSS tersimpan, oracle konten belum-terbit, atau saluran spam". Keputusan yang harus mengikat **sebelum** kode: siapa yang memiliki komentar, ke arah mana dependency mengalir, lewat seam apa modul konten menyatakan resource-nya boleh dikomentari, dan apa tulang punggung keamanannya.

Fakta grounding yang sudah ada dan **tidak** ditulis ulang modul ini:

- `blog_content` sudah punya predikat "publik + terbit" tunggal, dan sejak ADR-0040 sudah **mendeklarasikannya sebagai data** lewat `searchSources`. `comments` mengonsumsi predikat yang sama lewat seam sejenis, bukan memodelkannya ulang.
- `tenant_domain` (#219) me-resolve tenant dari host untuk rute publik; `site_search` sudah memakai pola itu (`withSiteSearchTenant`).
- `data_lifecycle` (ADR-0037) sudah menyediakan mesin purge generik + legal hold non-bypassable.
- `domain_event_runtime` sudah menyediakan outbox transaksional, sehingga notifikasi balasan tidak perlu memanggil provider di dalam transaksi (ADR-0006).

## Keputusan

Kami mengadmisi **`comments`** sebagai **Official Optional Module** (fitur produk generik lintas domain website, opt-in per tenant), **moderation-first secara default**, dan mewujudkan kolaborasinya lewat **commentable-resource contribution contract** — bukan impor lintas-modul, bukan tulisan langsung ke tabel modul lain.

Arah kepemilikan sama seperti ADR-0040: **modul konten adalah PENYEDIA descriptor; `comments` adalah KONSUMEN/agregator.** Tidak ada modul yang dibuat bergantung pada `comments`, dan `comments` hanya bergantung pada Core — graf tetap DAG-safe.

### 1. Parameter admission

| Parameter                | Nilai                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Nama                     | Comments                                                                                                                                      |
| `key`                    | `comments`                                                                                                                                    |
| Kategori                 | **Official Optional Module** — kebutuhan generik situs publik lintas vertikal, opt-in per tenant                                              |
| `type` di kode           | `domain` (sama seperti `blog_content`/`seo_distribution`/`site_search`)                                                                       |
| `isCore`                 | tidak                                                                                                                                         |
| `status`                 | `active` — descriptor + kode runtime mendarat bersama                                                                                         |
| Lifecycle `dependencies` | `["tenant_admin", "identity_access"]` **saja**                                                                                                |
| Kontribusi resource      | descriptor-list `ModuleDescriptor.commentableResources` (§3) — **bukan** capability `provides` (>1 penyedia = `capability_provider_conflict`) |
| Kelas kompatibilitas     | Penyimpanan + moderasi murni DB = **offline-lan-safe**; notifikasi balasan butuh provider email = **degradasi bersih saat tak dikonfigurasi** |

### 2. Arah dependency — kenapa panah menunjuk ke DALAM

| Modul          | Peran terhadap `comments`                            | Lifecycle `dependencies`              |
| -------------- | ---------------------------------------------------- | ------------------------------------- |
| `blog_content` | **penyedia** commentable resource (`blog_post`)      | tidak berubah                         |
| `news_portal`  | menyusun post, bukan resource mandiri                | tidak berubah                         |
| `email`        | konsumen event balasan (follow-up), bukan dependency | tidak berubah                         |
| `comments`     | **konsumen/agregator** (memiliki thread + komentar)  | `["tenant_admin", "identity_access"]` |

**Invariant yang dikunci:** tidak ada modul yang `dependencies`- atau `consumes`-nya menyebut `comments`. Kalau arahnya dibalik — `comments` mengimpor tiap modul konten — agregator akan menyeret dependency ke setiap modul konten yang menyusul.

### 3. Seam: `commentableResources`, bukan capability

`MODULE_CONTRACT_VERSION` naik `2.2.0` → **`2.3.0`** (field opsional aditif). Bentuknya identik `searchSources`, dan alasannya sama: **banyak** modul konten akan mau menerima komentar, dan penyedia kedua akan men-trip `capability_provider_conflict`.

Descriptor adalah **data murni** — nama tabel/kolom yang sudah di-review plus `publicationFilter` deklaratif. Tidak ada function reference yang menyeberangi seam. Engine `comments` membangun query publikasi ter-parameterisasi: **nilai** filter selalu bound parameter, hanya **identifier** yang di-interpolasi, dan tiap identifier di-validasi ulang dengan `assertSafeIdentifier`/`assertSafeTableName` **tepat sebelum** interpolasi. Gate registry (`bun run comments:resources:check`) dan validasi kedua itu sengaja redundan: gate membuktikan registry yang ter-commit bersih, validasi kedua membuktikan string yang sampai ke `tx.unsafe` bersih — tak peduli bagaimana ia sampai ke sana.

### 4. Email lewat event, bukan dependency (ADR-0006)

Notifikasi balasan diterbitkan sebagai domain event ke outbox `domain_event_runtime` (same-commit). Payload **tidak pernah** membawa alamat penerima — hanya id opaque. Dispatcher email me-resolve alamat terenkripsi saat kirim, **di luar** transaksi DB. Konsekuensinya `comments` tidak punya dependency ke `email`, dan deployment tanpa provider email tetap berfungsi penuh untuk komentar itu sendiri.

### 5. Tulang punggung keamanan

Ini permukaan tulis publik tak terautentikasi, jadi kontrolnya dinyatakan eksplisit:

1. **Batas publikasi.** Komentar hanya diterima/ditampilkan terhadap resource yang lolos `publicationFilter` milik modul pemiliknya. Resource draft/privat/terhapus/terjadwal tak pernah menerima maupun mengekspos komentar. **Permukaan komentar tidak pernah jadi sumber otorisasi** untuk resource di bawahnya.
2. **Anti-XSS tersimpan by construction.** Body disimpan sebagai **teks polos mentah**, tak pernah HTML. Saat render, **setiap** karakter di-escape lebih dulu, baru URL http(s) telanjang di-autolink dengan href dan teks tampak yang sama-sama ter-escape plus `rel="nofollow ugc noopener noreferrer"`. Tidak ada allow-list sanitizer yang bisa salah, dan tidak ada jalur komentar tersimpan sampai ke browser sebagai markup.
3. **Tanpa oracle.** Respons submit publik **seragam**: resource tak resolve, modul disabled, blokir anti-abuse, dan komentar diterima-tapi-tertahan semuanya mengembalikan `{"status":"received"}`. Hanya komentar yang langsung publik yang membuka id-nya. Operasi author-bound (edit, delete-request) mengembalikan **404, bukan 403**, saat pemanggil bukan penulisnya.
4. **Anti-abuse server-side.** Honeypot, lantai waktu-submit ber-HMAC, batas panjang/tautan, blocked terms per tenant, fingerprint duplikat, rate limit per IP. Semua **fail-closed**: dengan lantai waktu aktif, token yang hilang dihitung `too_fast`, sehingga menghapus token bukan cara melewatinya.
5. **Minimisasi PII.** Alamat email penulis tak pernah disimpan mentah — hanya sha256 + bentuk ter-mask. IP dan user-agent hanya sebagai hash ber-salt tenant. Alamat langganan notifikasi dienkripsi AES-256-GCM dengan kunci terpisah; tanpa kunci, yang tersimpan adalah sentinel tak-ter-resolve, **bukan** plaintext.
6. **Isolasi tenant.** Ketujuh tabel `ENABLE` **dan** `FORCE` RLS (`ENABLE` tanpa `FORCE` inert selama app connect sebagai pemilik tabel), plus predikat `tenant_id` eksplisit.

### 6. Permission: nol action baru

Delapan permission (`sql/067`), semuanya memakai literal `AccessAction` yang **sudah ada**. Menandai spam memakai `reject`, bukan action `spam` baru: spam adalah subtipe penolakan dengan blast radius identik, dibedakan oleh reason code yang teraudit. Menciptakan action baru justru menanam jebakan latent-authz — action yang tak pernah di-seed ke role mana pun akan men-deny bahkan tenant owner, sementara kodenya terlihat benar.

### 7. Adaptasi khas `awcms` (bukan kelalaian)

| Hal                 | awcms-micro                           | Di sini                                                                                                                                                            |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `urlTemplate`       | `:slug`/`:id` (host-resolved)         | tambah **`:tenantCode`** — rute konten publik basis ini path-tenant-scoped (ADR-0009). Template yang memintanya tanpa kode **melempar**, bukan menulis placeholder |
| Prefix tabel        | `awcms_micro_`                        | `awcms_`                                                                                                                                                           |
| Secret timing token | konstanta fallback di source          | kunci acak per-proses + peringatan (preseden `AUTH_IP_HASH_SECRET`); konstanta di repo publik = tanda tangan yang bukan tanda tangan                               |
| Cursor keyset       | `created_at` ter-materialisasi        | teks presisi penuh `to_char(...)` + tiebreak `(created_at, id)` — perbaikan kelas bug Issue #158                                                                   |
| `published_at`      | di-NULL-kan tiap transisi non-approve | dipertahankan (`coalesce`) — meng-arsip yang menghapus jejak pernah-terbit menyangkal tujuan arsip itu sendiri                                                     |
| Event `anonymize`   | tidak pernah ditulis                  | ditulis sweep retensi — `sql/066` memberi worker INSERT untuk itu, jadi grant-nya harus jujur                                                                      |
| Halaman admin       | SPA client-fetch                      | SSR + satu script ter-bundle eksternal (CSP melarang inline); body dirender **teks polos**, tak pernah HTML                                                        |
| Typeahead/i18n      | katalog gettext                       | label literal — basis ini belum punya runtime katalog i18n                                                                                                         |

### 8. Konsekuensi

**Positif.** Satu pemilik komentar untuk seluruh basis; modul konten menerima komentar dengan satu deklarasi data tanpa impor silang; permukaan tulis publik punya tulang punggung keamanan yang eksplisit dan teruji; retensi/legal-hold ikut mesin generik yang sudah ada.

**Negatif / biaya yang diterima.** Satu MINOR lagi pada `MODULE_CONTRACT_VERSION` (dan pin manifest keluarga). Satu gate lagi di rantai `check`. Notifikasi balasan belum punya consumer dispatcher — event-nya terbit, pengirimannya follow-up terdokumentasi. `blog_content` kini mendeklarasikan predikat publikasi yang sama **dua kali** (search + comments); tak ada di tipe yang menyatukannya, jadi kopling itu ditegakkan test yang sudah dibuktikan merah saat sengaja di-drift.

**Netral.** `ARCHIVE_REASON_CODE` menempati satu reason code cadangan; reason bebas milik moderator tidak boleh bertabrakan dengannya.
