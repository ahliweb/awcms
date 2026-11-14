🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](whatsapp-meta-enable-runbook.md)

<!-- i18n-source-hash: sha256:6eaed57f1b5a8ab25fe995750d6df685bf61e024f4530bc1e0dcfd3b9d8fbbbc -->

<!-- i18n-source-hash: sha256:0 -->

# Pengirim WhatsApp Meta — runbook pengaktifan (Issue #1298)

Pembaca: operator yang menyalakan jalur Meta Cloud API milik tenant pada deployment yang **sudah memegang nomor Meta**, dan orang yang meninjau perubahan itu. Latar belakang: [README `whatsapp_delivery`](../../src/modules/whatsapp-delivery/README.id.md#pengirim-meta-cloud-api-multi-waba-issue-1143) (Issue #1143) dan temuan L5 audit independen #1267.

## 0. Mengapa dokumen ini ada

Sejak #1143 sebuah nomor Meta milik tenant mengirim hanya sebagai bagian dari **kontainer WABA yang hidup**, dan pesan template butuh **persetujuan yang dapat dikirim dengan kategori benar pada WABA itu**. Baris yang diantrekan sebelumnya, dan nomor yang didaftarkan sebelumnya, tidak punya keduanya. Mereka tidak gagal saat pengaktifan: mereka gagal **terminal pada dispatch berikutnya**, termasuk baris OTP (`security`) yang sudah mengantre dan tidak bisa dikirim ulang tepat waktu. Tidak ada yang dialihkan dan tidak ada yang jatuh ke teks bebas. Jadi pemeriksaan harus dilakukan **sebelum** jalur dinyalakan.

## 1. Preflight (read-only)

```sh
bun run whatsapp:meta:preflight
```

Per tenant ia membaca tiga hal sebagai `awcms_worker` (role dispatcher sendiri): nomor Meta yang terhubung beserta induk WABA-nya, apa yang mengantre pada nomor itu (`queued`, `retry_wait`, `sending`), dan persetujuan template. Ia memakai aturan dispatcher sendiri (`decideMetaSend`) dan mencetak, per kode tenant, hanya id akun, kunci template, dan jumlah — tidak pernah nomor, penerima, hash, isi, atau token. Ia tidak menulis apa pun dan tidak memanggil provider.

Exit `0` = tidak ada yang mengantre pada nomor Meta yang akan gagal terminal. Exit `1` = setidaknya satu baris di bawah, atau tenant yang tidak bisa dibaca.

| Baris                                    | Arti                                                                                                                                       | Perbaikan                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `number ... has NO live WABA parent`     | Nomor didaftarkan tanpa kontainer `waba` (atau kontainernya dihapus). Setiap baris padanya, OTP termasuk, gagal dengan pengikatan tak sah. | Daftarkan WABA (`account_kind: waba`, `external_id` = id WABA) dan pindahkan induk nomor ke sana.                                                                                                         |
| `... will fail (TEMPLATE_NOT_APPROVED)`  | Tidak ada persetujuan yang dapat dikirim dengan kategori benar untuk template itu pada WABA nomor itu. Baris menyebut template dan bahasa. | Di WhatsApp Manager pastikan template `APPROVED`, lalu catat: `PUT /api/v1/whatsapp/meta-templates` dengan `evidenceRef`. Webhook status bertanda tangan menjaganya tetap mutakhir sesudahnya (bagian 3). |
| `... will fail (OUTSIDE_SERVICE_WINDOW)` | Baris teks bebas yang penerimanya belum menulis ke nomor ini dalam 24 jam terakhir.                                                        | Tidak ada yang dicatat: jendela Meta terbuka (orangnya menulis lebih dulu) atau baris dibatalkan. Pemasaran tidak pernah teks bebas.                                                                      |
| `... will fail (TEMPLATE_UNREGISTERED)`  | Kunci template tidak terdaftar di proses ini (template modul konsumen didaftarkan oleh entrypoint job).                                    | Deploy kode konsumen, atau batalkan barisnya.                                                                                                                                                             |
| `the approval list was truncated`        | Tenant dengan lebih dari 5000 baris persetujuan: baris "not approved" mungkin baris yang tidak terbaca.                                    | Periksa tenant itu manual.                                                                                                                                                                                |

Backfill persetujuan **sengaja tidak diotomatiskan**. Persetujuan adalah fakta Meta dan butuh bukti (`evidenceRef`); skrip yang menulis baris `APPROVED` akan mengizinkan pengiriman yang lalu ditolak Meta, dan memalsukan jejak audit siapa menyatakan apa.

## 2. Urutan pengaktifan

1. Deploy build berisi `sql/392` dan `sql/393` lalu jalankan `bun run db:migrate`. (`sql/392` mempersempit hak tulis dispatcher pada antrean; `sql/393` menaruh ledger webhook pada jam database.)
2. Jalankan `bun run whatsapp:meta:preflight` terhadap data produksi. Selesaikan setiap baris, atau kosongkan dengan sengaja baris yang disebutnya (batalkan) — jangan menyalakan dengan baris `security` yang diketahui akan gagal.
3. Jalankan `bun run security:readiness` dengan environment produksi. Ia mem-pin grant kolom baru, trigger penjaga worker, dua trigger jam, dan hak app yang dipersempit; temuan di sana berarti migrasi tidak berlaku.
4. Untuk tiap nomor Meta buat webhook subscription-nya (`POST /api/v1/channel-accounts/accounts/{id}/webhook-subscription`) dan atur callback URL di Meta (bagian 3).
5. Setel `WHATSAPP_ENABLED=true` untuk proses web dan job `whatsapp:dispatch`. Jalankan preflight sekali lagi (murah) dan awasi pass pertama.

## 3. Setelah dinyalakan

- **Webhook.** `https://<host>/api/v1/whatsapp/webhooks/meta/<token>` per nomor, token yang sama sebagai verify token. Atur reverse proxy agar tidak mencatat `/api/v1/whatsapp/webhooks/`. Meta mengulang non-200 hingga tujuh hari; body yang sudah diterapkan dijawab `200` dan tidak mengubah apa pun.
- **Pengiriman lebih tua dari tujuh hari** (menurut `entry.time`-nya) tidak mengubah status template, batas, atau pembatasan: ia tidak bisa dibedakan dari replay body yang tertangkap begitu receipt-nya hilang. Event berikutnya memperbaiki keadaan.
- **Pembatasan yang di-clear operator** tetap ter-clear terhadap event yang dicap Meta sebelum clear; hanya event yang lebih baru yang membatasi lagi.
- **429 pada webhook.** Bucket per-alamat hanya menghitung permintaan yang belum terverifikasi; bucket per-(tenant, alamat) (1200 per menit) dikembalikan untuk pengiriman baru yang terverifikasi, jadi tenant yang sibuk tidak dibatasi oleh lalu lintasnya sendiri. Tenant yang melihat `429` sedang mengirim penolakan atau duplikat: periksa app secret-nya dan perilaku retry Meta.

## 4. Membatalkan

Cabut `WHATSAPP_ENABLED` (web dan job) lalu restart. Baris yang sudah `sent` tetap `sent`; baris antrean tetap mengantre dan dikirim atau digagalkan menurut aturan yang sama saat flag kembali. `sql/392` dan `sql/393` bersifat maju-saja dan tak perlu dibatalkan: keduanya hanya mempersempit hak dan mengisi jam.
