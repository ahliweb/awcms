🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:345dc3bc3d21259351a0acbb27cb261e3cbd1b21f6d2128c3c9d2fc9b9ff5add -->

# `website_engagement`

**Penangkapan lead dan kontak situs web** per tenant serta event interaksi situs web masuk (Issue #1153, [ADR-0155](../../../docs/adr/0155-website-engagement-is-an-intake-only-system-module-with-token-and-origin-provenance.id.md); desain dan catatan keamanan di [`docs/awcms/website-engagement.id.md`](../../../docs/awcms/website-engagement.id.md)).

Situs web milik tenant mengirim permintaan kontak, lead, atau interaksi ke SATU endpoint publik yang sengaja tanpa autentikasi, `POST /api/v1/website-engagement/submissions`. Permintaan diterima hanya dengan token buram per-**source** (disimpan hanya sebagai hash berkunci, ditampilkan sekali) **dan** host `Origin` yang terdaftar untuk source itu, dalam rate limit per alamat dan per source, di balik tantangan Turnstile opsional, terhadap himpunan field **tertutup dan berversi**. Data disimpan dengan **provenance persetujuan eksplisit** dan atribusi sumber, detail kontaknya terenkripsi saat disimpan, dan diumumkan oleh event outbox yang dikonsumsi adapter CRM.

**Hanya intake.** Bukan CRM, bukan pipeline lead, bukan mesin formulir, bukan widget obrolan; ia tidak membuat, mencocokkan, atau menggabungkan orang, tidak menyimpulkan identitas pengunjung (tidak ada sidik jari, cookie, IP, atau user agent yang disimpan), tidak menerima HTML atau unggahan, dan tidak membuat permintaan keluar saat menerima data. Widget tertanam telah dinilai dan **tidak dibangun** (lihat dokumen desain).

- **Tabel** (`sql/325`): `awcms_engagement_sources`, `awcms_engagement_source_domains`, `awcms_engagement_submissions`; RLS `FORCE`, `WITH CHECK`; penjaga integritas di `sql/327`; izin di `sql/326`.
- **Event**: `awcms.website_engagement.submission.received` dan `...submission.withdrawn` (AsyncAPI), membawa referensi buram, tidak pernah detail pengunjung.
- **API admin**: source (buat, ubah, rotasi, cabut, hapus), pembacaan kiriman tersamar, **reveal** teraudit, dan **penarikan** oleh pengendali; setiap rute default-deny.
- **Layar admin** (Issue #1153, `active`): `/admin/website-engagement` (daftar kiriman: halaman keyset, filter sumber, jenis, dan status, hanya kontak tersamar), `/admin/website-engagement/{id}` (catatan persetujuan, atribusi, asal-usul, dan **penarikan** yang dikonfirmasi dan idempoten) dan `/admin/website-engagement/sources` (situs web terdaftar, host yang diterima, tantangan efektif, hanya **awalan** token, **pencabutan** yang dikonfirmasi). Layar membaca lewat fungsi direktori API sendiri (`application/screen-loaders.ts`), tidak pernah mendekripsi dan tidak pernah memilih token atau hash-nya. Buat, ubah, jeda, putar, dan **reveal** yang diaudit tetap hanya API: token ditampilkan sekali dan reveal merender data pribadi, sehingga masing-masing butuh kontrak layar sendiri (`submissions.reveal` masih di ledger `NOT_YET_SCREENED`).
- **Retensi**: dideklarasikan di `module.ts` lewat `data_lifecycle` (bawaan 180 hari).
- **Konfigurasi**: DUA cincin kunci, `WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS` (detail kontak) dan `WEBSITE_ENGAGEMENT_HASH_KEYS` (hash token source dan identifier), keduanya wajib untuk menyimpan apa pun (gagal tertutup) dan tidak berbagi kunci (ADR-0137 bagian 3, Issue #1262): satu sama lain, ditegakkan saat runtime dan oleh `config:validate`; dengan cincin modul lain atau secret kunci-tunggal, ditegakkan oleh `config:validate`; `WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS` yang opsional dan sementara; serta variabel rate limit di `.env.example`.

Tata letak: `domain/` (murni: token, validator, kebijakan origin, event, pesan, cincin kunci), `application/` (direktori source dan kiriman, intake, handler publik, hitungan transisi kunci), `module.ts`. Rute berada di `src/pages/api/v1/website-engagement/`.

## Cincin kunci dan transisi dari cincin tunggal (Issue #1262)

Sampai Issue #1262 satu cincin, `WEBSITE_ENGAGEMENT_KEYS`, sekaligus mengenkripsi detail kontak dan menjadi kunci setiap hash, yang dilarang ADR-0137 bagian 3: kunci yang bocor membuka ciphertext dan oracle hash sekaligus. Variabel itu kini **dipensiunkan**: bila masih diisi, setiap rute yang meng-hash atau mendekripsi (intake publik, buat dan rotasi source, serta reveal) menjawab 503 (`KEY_RING_UNAVAILABLE` dengan pesan generik "konfigurasi kunci ditolak", atau penolakan publik generik) dan mencatat kode penyebab tetap di log (`retired_variable`, `missing_or_invalid`, atau `conflicting_keys`, tidak pernah sebuah nilai); `config:validate` gagal dengan menyebut namanya. Ia tidak pernah diam-diam dipakai untuk salah satu peran. Rute yang tidak menyentuh materi kunci (daftar, pembacaan tersamar, ubah, cabut, hapus, penarikan) tetap berjalan.

| Variabel                              | Peran                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS`  | Kunci pertama mengenkripsi detail kontak baru; semua kunci mendekripsi.                                           |
| `WEBSITE_ENGAGEMENT_HASH_KEYS`        | Kunci pertama menulis setiap hash token dan identifier baru; semua kunci memverifikasi.                           |
| `WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS` | Sementara, hanya verifikasi: diterima saat token source (atau hash identifier lama) dicari; tidak pernah menulis. |

Aturan yang diperiksa oleh predikat yang sama saat runtime **dan** di `config:validate`:

- cincin enkripsi dan hash tidak berbagi kunci;
- kunci lama bukan kunci hash aktif (menurut materi) maupun id kunci hash aktif;
- kunci lama tidak pernah menjadi kunci enkripsi **pertama** (penulis);
- kunci lama dan kunci enkripsi sepadan persis: id yang sama berarti materi yang sama, dan materi yang sama tetap ber-id sama;
- kunci pertama (penulis) kedua cincin tidak memakai id kunci lama.

Hanya diperiksa oleh `config:validate`: tidak ada cincin atau kunci lama yang berbagi materi dengan cincin modul lain atau secret kunci-tunggal deployment (runtime tidak membaca variabel modul lain).

**Jangan pernah memakai ulang id kunci untuk materi baru.** Id kunci menamai materi yang menulis sebuah baris. Menulis kunci BARU sebagai `k1` sementara baris lama menyebut `k1` membuat setiap baris lama tampak terkini padahal tidak lagi terbuka. Beri setiap kunci baru id baru; aturan di atas menolak kasus yang terlihat dari konfigurasi, dan `security:readiness` menangkap sisanya dengan mendekripsi satu sampel ciphertext per id kunci enkripsi dan menghitung ulang satu sampel hash identifier per id kunci hash (yang dilaporkan hanya id kunci, tidak pernah nilai).

**Runbook untuk deployment yang sudah berjalan** dengan cincin lama `k1:<OLD>`:

1. Buat dua kunci baru (`openssl rand -base64 32` dua kali).
2. Isi `WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS=e2:<NEW_E>,k1:<OLD>` (kunci lama terakhir: hanya mendekripsi kiriman lama), `WEBSITE_ENGAGEMENT_HASH_KEYS=h1:<NEW_H>`, dan `WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS=k1:<OLD>`; kosongkan `WEBSITE_ENGAGEMENT_KEYS`.
3. Jalankan `bun run config:validate`, lalu deploy. Setiap token source yang ada tetap berfungsi: ia terverifikasi lewat kunci lama dan, pada kiriman pertamanya yang diterima, hash tersimpannya ditulis ulang di bawah `h1` (compare-and-swap, sehingga rotasi yang terjadi bersamaan tidak pernah dibatalkan). Kiriman baru dienkripsi dengan `e2` dan di-hash dengan `h1`.
4. Pantau `bun run security:readiness`: "Website engagement source tokens are under the active hash key" menampilkan source hidup per id kunci dan gagal bila sebuah sampel tidak terverifikasi dengan materi yang dikonfigurasi. Setiap token yang cocok di bawah kunci selain kunci hash aktif di-hash ulang pada kiriman berikutnya yang diterima (kunci lama transisi, dan juga kunci lama setelah rotasi cincin hash biasa). Rotasi source yang tidak pernah mengirim (`POST /api/v1/website-engagement/sources/{id}/rotate`). Bila tidak ada source hidup tersisa pada `k1`, kosongkan `WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS`.
5. "Website engagement contact ciphertexts are under the active key" menampilkan ciphertext kontak tersimpan per id kunci dan gagal bila sampel per id kunci tidak dapat didekripsi. Hapus `k1` dari cincin enkripsi hanya bila angkanya nol di sana **dan** di setiap backup yang mungkin dipulihkan (ADR-0137 bagian 2).

Hash identifier (`email_hash`, `phone_hash`) yang ditulis sebelum transisi tetap di bawah `k1`; tidak ada pembaca di repo ini yang mencarinya saat ini, dan hash itu hanya ter-resolve lewat `lookupHashCandidates` selama kunci lama dikonfigurasi. Konsumen masa depan yang mencarinya wajib mempertahankan kunci lama sampai langkah 5 mencapai nol.

**Keputusan terbuka (gagal tertutup).** Sengaja **tidak ada job enkripsi ulang atau hash ulang** untuk kiriman: kiriman adalah bukti append-only dan penjaga `sql/327` menolak penulisan ulang ciphertext atau hash-nya di luar penarikan. Baris lama karena itu keluar lewat purge retensi (bawaan 180 hari) atau penarikan, dan kunci lama tetap menjadi kunci khusus dekripsi sampai saat itu. Melonggarkan penjaga bukti untuk mengizinkan re-key di tempat adalah keputusan terpisah (itu membiarkan aplikasi menulis ulang bukti tersimpan) dan tidak diambil di sini.

## Risiko sisa

- Profil offline/LAN tanpa Turnstile: token bocor ditambah Origin palsu non-browser hanya dibatasi oleh batas per alamat (berkunci IPv6 /64), jatah per source, dan retensi.
- Limiter berjalan di dalam proses kecuali Redis dikonfigurasi.
- Preflight menampakkan apakah sebuah hostname adalah domain tenant aktif pada deployment (seperti `newsletter`).
- Field atribusi memakai set karakter tertutup tetapi tidak dapat membuktikan sebuah nilai bukan data pribadi.
- Klik ganda pada formulir bertantangan dapat gagal di tantangan kedua (sekali pakai).
- Temuan audit L3, L5, dan informasional diterima sebagaimana tercatat di laporan audit dan tidak ditangani pada irisan ini.
- Tidak ada kanal penarikan publik, mode server-ke-server, atau masa tenggang rotasi; tidak ada layar untuk membuat, mengubah, atau memutar sumber maupun untuk reveal (hanya API); tidak ada filter rentang tanggal (API daftar tidak punya; layar memfilter menurut sumber, jenis, dan status). Daftar sumber adalah daftar API yang dibatasi 200.
