🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](push-notifications-test-matrix.md)

<!-- i18n-source-hash: sha256:9d5f201096fbc554809b318ba3e8ddd29830db9fc0954543958a0fb7f6500600 -->

<!-- i18n-source-hash: sha256:0 -->

# Notifikasi Push — Matriks Uji Operator dan Runbook

Cakupan: Issue #1107. Rencana bukti untuk pengirim Web Push Bun
(`bun run push:dispatch`, ADR-0074) bersama admin iOS yang dapat dipasang
(#1105) dan payload deklaratif (#1106). Memakai ulang `/admin/push-notifications`,
`POST /api/v1/push/test`, `GET /api/v1/push/diagnostics` dan skrip yang ada;
**tidak** menambah konsol, antrean, atau pengirim baru. Latar belakang dan
rollout: [`push-notifications.id.md`](push-notifications.id.md).

## 1. Empat istilah yang tidak boleh tertukar

| Istilah                   | Artinya                                                                                                                     | Siapa yang dapat mengamati                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Langganan diterima**    | Browser membuat `PushSubscription` dan server menyimpan baris (`awcms_push_subscriptions`, `status=active`).                | Server (daftar perangkat di `/admin/push-notifications`).   |
| **Provider menerima**     | Layanan push (Apple/Google/Mozilla/Microsoft) menjawab HTTP **201/202**. Baris antrean menjadi `sent`; percobaan `success`. | Hanya server. **Ini batas pengetahuan produk.**             |
| **Perangkat menampilkan** | Seseorang melihat banner di perangkat (atau layar kunci).                                                                   | Manusia di perangkat. Tidak pernah disimpulkan dari server. |
| **Diklik / bernavigasi**  | Mengetuk banner membuka aplikasi di halaman same-origin yang dituju.                                                        | Manusia di perangkat.                                       |

`sent` di antrean, `last_success_at` pada langganan, dan log
`push.dispatch.sent` semuanya berarti **provider menerima**. 201 tidak menjamin
tampil: layanan dapat menahan pesan untuk perangkat offline, membuangnya saat TTL
habis, atau perangkat menekannya (Focus/DND, izin dicabut, aplikasi dihapus).
Jangan melaporkan "terkirim ke perangkat" dari penerimaan provider, dan jangan
mengklaim persentase pengiriman darinya.

Siklus pesan di server: `queued -> sending (lease klaim) -> sent | retry_wait ->
sending ... | failed | cancelled`. `410/404` juga menonaktifkan langganan. Setiap
percobaan menulis satu baris `awcms_push_delivery_attempts`.

## 2. Parameter pengiriman saat ini (diperiksa, tidak diubah)

| Parameter        | Nilai / lokasi                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TTL Web Push     | 4 jam (`DEFAULT_TTL_SECONDS` di `web-push-provider.ts`). Setelahnya layanan push membuang pesan yang belum terkirim.                                     |
| Kadensi worker   | `push:dispatch` tiap menit di `deploy/cron/awcms.crontab`, tiap 2 menit di `ops/awcms-jobs.crontab` (satu tenant sekali jalan, dijaga `flock`).          |
| Lease klaim      | 2 menit (`PUSH_DISPATCH_LEASE_MINUTES`); baris `sending` yang lewat lease-nya diklaim ulang.                                                             |
| Retry            | `PUSH_SEND_MAX_RETRIES` (bawaan 3); backoff `2^n` menit dibatasi 15; dapat diulang = 429, 5xx, galat/timeout transport.                                  |
| Timeout provider | `PUSH_SEND_TIMEOUT_MS`, bawaan 10.000 ms.                                                                                                                |
| Langganan mati   | 404/410 -> langganan `disabled`, pesan antre dibatalkan; tanpa retry.                                                                                    |
| Jendela duplikat | Crash setelah layanan push menerima tetapi sebelum baris ditandai `sent` dapat mengirim ulang sekali (trade-off yang diterima, lihat header dispatcher). |
| Circuit breaker  | Kunci bersama `push-delivery`; 404/410 dan 4xx permanen tidak memicunya, 429/5xx/galat transport memicunya.                                              |

Tidak ada perubahan yang diusulkan: belum ada baseline operasional yang
membenarkan ambang baru. Tinjau ulang setelah bukti perangkat nyata (bagian 5) ada.

## 3. Cakupan otomatis (dapat diputar ulang, tanpa perangkat)

Jalankan dengan `bun run test` (unit, tanpa database) dan, untuk baris
integrasi, `DATABASE_URL=<postgres> bun test tests/integration/<berkas> --timeout 60000`
dalam prosesnya sendiri. Semuanya berhenti di **provider menerima**.

| #   | Skenario                                                                                                                           | Berkas uji                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A1  | Enqueue -> dispatch -> provider menerima (201) -> `sent`, baris percobaan, tanpa kirim ganda; **kedua** format payload             | `tests/integration/push-operator-matrix.integration.test.ts` (#1107)                                        |
| A2  | 429 / 503 / timeout transport: `retry_wait`, backoff, tidak dikirim ulang lebih awal, lalu diterima                                | sama (#1107)                                                                                                |
| A3  | Batas retry tercapai -> `failed`; 403 permanen -> `failed` seketika                                                                | sama (#1107)                                                                                                |
| A4  | 404 / 410 gone -> langganan dinonaktifkan, keluar dari fan-out berikutnya                                                          | sama (#1107); pemetaan di `tests/push-web-push-adapter.test.ts`                                             |
| A5  | Dispatch tenant A tidak pernah menjangkau tenant B; RLS menyembunyikan baris B                                                     | sama (#1107)                                                                                                |
| A6  | Unsubscribe/revoke membatalkan pesan antre, tidak ada yang terkirim setelahnya                                                     | sama (#1107); juga `push-rekey-takeover` (disable membatalkan antrean)                                      |
| A7  | Worker crash di tengah batch: lease dihormati, diklaim ulang setelah habis, tanpa kirim ganda; dua worker serentak mengirim sekali | sama (#1107)                                                                                                |
| A8  | Dispatch terikat penerima, transfer endpoint, audit hanya id, klaim L1 yang sedang berjalan                                        | `tests/integration/push-rekey-takeover.integration.test.ts` (#1098)                                         |
| A9  | Auth secret terenkripsi saat disimpan, pengiriman legacy/ciphertext, ciphertext baris lain ditolak                                 | `tests/integration/push-auth-secret-at-rest.integration.test.ts`, `tests/push-auth-secret*.test.ts` (#1089) |
| A10 | Anggaran query enqueue, `data` sebagai jsonb, satu baris per perangkat                                                             | `tests/integration/push-enqueue-budget.integration.test.ts`                                                 |
| A11 | Vektor RFC 8291, VAPID (RFC 8292), header, pemetaan respons                                                                        | `tests/push-web-push-adapter.test.ts`, `tests/push-fcm-adapter.test.ts`                                     |
| A12 | Bentuk payload `legacy`/`declarative`, `navigate` berbahaya, batas ukuran, pembaca ganda SW dan penanganan klik                    | `tests/push-payload-format.test.ts` (#1106)                                                                 |
| A13 | Validasi registrasi, kepemilikan di statement, diagnostik tidak membuka endpoint                                                   | `tests/push-http-surface.test.ts`, `tests/push-delivery.test.ts`                                            |
| A14 | Kontrak halaman admin, manifest/installability                                                                                     | `tests/admin-push-notifications-page-contract.test.ts`, uji manifest PWA (#1105)                            |

Tidak dapat diotomatisasi sehingga **tidak diklaim**: tampilan banner, perilaku
layar kunci, Focus/DND, keterlambatan OS, navigasi klik di perangkat nyata.

## 4. Matriks UAT perangkat nyata (status: PENDING, manusia)

Setiap sel di bawah **PENDING (manusia)**. Tidak ada baris yang boleh ditandai
lulus tanpa bukti di bagian 6. Kolom sengaja dipisah: satu baris bisa
"provider menerima" sementara "perangkat menampilkan" gagal.

Legenda sel: `PENDING` = belum dijalankan. Isi `PASS`, `FAIL` (catat di bagian 7)
atau `N/A`.

| #   | Perangkat / mode                                                              | Langganan diterima        | Provider menerima | Perangkat menampilkan | Klik bernavigasi | Unsubscribe berhenti |
| --- | ----------------------------------------------------------------------------- | ------------------------- | ----------------- | --------------------- | ---------------- | -------------------- |
| U1  | Chrome desktop, tab ditutup, browser berjalan                                 | PENDING                   | PENDING           | PENDING               | PENDING          | PENDING              |
| U2  | Chrome desktop, browser keluar sepenuhnya (OS dapat memulai ulang)            | PENDING                   | PENDING           | PENDING               | PENDING          | PENDING              |
| U3  | Chrome Android, aplikasi latar belakang dan layar terkunci                    | PENDING                   | PENDING           | PENDING               | PENDING          | PENDING              |
| U4  | Edge desktop (Windows/macOS)                                                  | PENDING                   | PENDING           | PENDING               | PENDING          | PENDING              |
| U5  | Firefox desktop                                                               | PENDING                   | PENDING           | PENDING               | PENDING          | PENDING              |
| U6  | Safari macOS (web push, Safari 16+)                                           | PENDING                   | PENDING           | PENDING               | PENDING          | PENDING              |
| U7  | iOS/iPadOS 16.4 - 18.3, PWA terpasang, tertutup dan terkunci (payload legacy) | PENDING                   | PENDING           | PENDING               | PENDING          | PENDING              |
| U8  | iOS/iPadOS 18.4+, PWA terpasang, tertutup dan terkunci (payload deklaratif)   | PENDING                   | PENDING           | PENDING               | PENDING          | PENDING              |
| U9  | Safari iOS **hanya tab** (tidak dipasang)                                     | diharapkan tidak didukung | n/a               | n/a                   | n/a              | n/a                  |

Pemeriksaan perilaku, dicatat per perangkat bila relevan:

| #   | Pemeriksaan                                                                                                                                                                                                                                            | Hasil   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| C1  | Focus / Jangan Ganggu aktif: banner ditekan, muncul di daftar notifikasi setelah Focus selesai atau tidak sama sekali (catat yang mana)                                                                                                                | PENDING |
| C2  | Perangkat offline lalu online dalam 4 jam: pesan tiba terlambat; offline melebihi TTL 4 jam: pesan dibuang, server tetap menampilkan `sent`                                                                                                            | PENDING |
| C3  | Izin dicabut di pengaturan OS/browser: pengiriman berikutnya mengembalikan 404/410, langganan menjadi `disabled`                                                                                                                                       | PENDING |
| C4  | Kunci VAPID tidak cocok / rotasi: pengiriman gagal 4xx permanen (tanpa banner), berlangganan ulang memulihkan                                                                                                                                          | PENDING |
| C5  | Logout / perangkat bersama / ganti tenant: pesan antre pengguna sebelumnya tidak muncul untuk pengguna berikutnya (pengikatan penerima, #1098)                                                                                                         | PENDING |
| C6  | Service worker lama masih terdaftar: payload `declarative` menampilkan fallback generik, `legacy` menampilkan teks normal                                                                                                                              | PENDING |
| C7  | Isi layar kunci: hanya judul/isi generik per kategori; tanpa PHI, pembayaran, atau data pribadi                                                                                                                                                        | PENDING |
| C8  | **`/login` di luar scope (#1105):** buka aplikasi iOS terpasang saat belum masuk; dialihkan ke `/login` (di luar `scope=/admin/`). Catat apakah iOS menampilkan bilah browser dalam-aplikasi dan apakah itu dapat diterima atau scope harus diperlebar | PENDING |

## 5. Gerbang pengalihan `PUSH_PAYLOAD_FORMAT`

**Jangan** set `PUSH_PAYLOAD_FORMAT=declarative` di produksi sebelum **semua**
berikut terpenuhi:

1. `public/push-sw.js` pembaca-ganda telah dideploy minimal satu siklus pembaruan
   service worker penuh (**24 jam**, batas atas pemeriksaan pembaruan browser)
   dengan `PUSH_PAYLOAD_FORMAT` tidak diset (legacy).
2. Bukti perangkat nyata (bagian 6) ada untuk U3 (Chrome Android), minimal satu
   baris desktop Chromium, **U7** (legacy tetap berfungsi) dan **U8** (deklaratif
   tampil sekali, klik bernavigasi). Penerimaan provider saja tidak dihitung.
3. C6 (fallback worker lama) dan C8 (scope `/login`) tercatat.
4. `bun run config:validate` lulus dengan `APP_URL` berupa URL `https:`.
5. Rollback sudah dilatih: set `PUSH_PAYLOAD_FORMAT=legacy`, restart app dan
   `push:dispatch`, kirim uji, konfirmasi tampil. Tanpa berlangganan ulang.

## 6. Templat bukti (satu per baris perangkat)

Salin blok ini ke Issue atau catatan rilis. Jangan menempel endpoint, kunci,
token, cookie, atau tangkapan layar yang memuat data pribadi.

```
Baris:                U#/C#
Penguji / tanggal:    <nama>, <timestamp ISO dengan zona waktu>
Model perangkat:      <mis. iPhone 15>
OS + versi:           <mis. iOS 18.4.1>
Browser + versi:      <mis. Safari / Chrome 131>
Origin:               <https://admin.example.test>
Mode:                 tab | PWA terpasang (dibuka dari ikon)
Status izin:          default | granted | denied
Format payload:       legacy | declarative
Langganan diterima:   <timestamp>  (muncul di daftar perangkat)
Uji dikirim:          <timestamp>  (POST /api/v1/push/test)
Provider menerima:    ya/tidak, hasil percobaan dari diagnostik, correlationId
Perangkat menampilkan:<timestamp atau "tidak tampil"> (layar kunci | banner | daftar)
Klik menuju:          <path> / <kegagalan>
Unsubscribe berhenti: ya/tidak (kirim lagi setelah "Matikan", harapannya tidak ada)
Bukti:                <id rekaman layar / foto, tanpa data pribadi>
Hasil:                PASS | FAIL | N/A
Catatan / batas diketahui: <...>
```

## 7. Log batas yang diketahui

Kegagalan dari bagian 4 dicatat di sini sebagai batas diketahui dengan tanggal,
baris, dan langkah reproduksi. Kosong berarti belum ada yang dijalankan,
**bukan** berarti tidak ada yang gagal.

| Tanggal | Baris | Batas yang teramati      | Keputusan |
| ------- | ----- | ------------------------ | --------- |
| --      | --    | (belum ada; UAT PENDING) | --        |

## 8. Runbook operator

**Triase "saya tidak menerima notifikasi"**, berurutan, memakai konsol yang ada
(`/admin/push-notifications`) dan `GET /api/v1/push/diagnostics`:

1. Apakah perangkat terdaftar dan `active`? Tidak -> langganan tidak pernah
   diterima, atau dinonaktifkan setelah 404/410: minta pengguna mengaktifkan lagi.
2. Apakah pesan ada di antrean? `queued`/`retry_wait` -> worker belum berjalan
   atau provider gagal: periksa log `push:dispatch` dan breaker.
3. `sent` dengan percobaan `success` -> **provider menerima**. Eskalasi ke
   perangkat: izin, Focus/DND, mode PWA terpasang di iOS, TTL habis, jaringan.
   Server tidak dapat tahu lebih jauh.
4. `failed` -> baca galat percobaan (dimasker; endpoint tidak pernah dilog).

**Kendali yang dijaga selama uji:**

- Deployment self-hosted: HTTPS keluar dari host worker ke layanan push
  (mis. `fcm.googleapis.com`, `web.push.apple.com`,
  `updates.push.services.mozilla.com`, `*.notify.windows.com`); aplikasi harus
  disajikan lewat HTTPS valid (iOS menolak sertifikat tak tepercaya).
- Rotasi kunci: ring `PUSH_AUTH_SECRET_ENCRYPTION_KEYS` plus
  `bun run push:auth-secret:rekey` (lihat `push-notifications.id.md`); perubahan
  kunci VAPID mengharuskan semua perangkat berlangganan ulang.
- PII: payload tidak membawa data pribadi, kesehatan, atau pembayaran;
  diagnostik menampilkan endpoint termasker; baris langganan adalah data pribadi
  menurut UU PDP 27/2022. Pemetaan ke ISO 27001/27002/27005/27701/22301 hanya
  referensi kendali; dokumen ini **tidak membuat klaim kepatuhan**.
- Purge: `bun run push:queue:purge` (harian) menghapus baris antrean terminal
  dan percobaan yang habis; baris langganan mengikuti deskriptor retensi.

## 9. Daftar go / no-go (sebelum mengaktifkan push untuk tenant atau mengalihkan format)

- [ ] CI hijau: `bun run check` dan job integrasi.
- [ ] Backup diambil dan restore diverifikasi untuk database.
- [ ] Kompatibilitas dikonfirmasi untuk perangkat target (baris bagian 4 PASS).
- [ ] Bukti UAT dilampirkan (bagian 6); batas diketahui dicatat (bagian 7).
- [ ] Pemantauan: log `push:dispatch`, status breaker, jumlah `failed` dan
      `retry_wait` di antrean ditinjau setelah pengiriman pertama.
- [ ] Rollback produsen deklaratif sudah dilatih (bagian 5, butir 5).
- [ ] Worker terkonfigurasi: `PUSH_ENABLED`, `PUSH_PROVIDER`, kunci VAPID,
      `PUSH_AUTH_SECRET_ENCRYPTION_KEYS`, `APP_URL`, entri cron ada.
- [ ] Pemilik operator ditunjuk untuk on-call dan rotasi kunci.
