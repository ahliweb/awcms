---
"awcms": minor
---

feat(push): antrean pengiriman push mendarat sebagai outbox KEDUA, bukan consumer domain-event

`awcms_domain_events` sudah punya dispatcher, DLQ, dan replay, jadi
menggantungkan pengiriman push padanya adalah langkah pertama yang wajar bagi
siapa pun. Ia tidak bisa, dan alasannya tertulis di berkasnya sendiri:
`dispatch-domain-events.ts` menyatakan di header-nya bahwa CLAIM + handler +
FINALIZE berjalan dalam **satu** transaksi, **sengaja**, dan memanggil handler
di dalamnya — sementara **ADR-0006 melarang panggilan jaringan di dalam
transaksi DB**. `broker-adapter-port.ts` sudah menuliskan konsekuensinya
("would need the lease-based shape back") dan ia sendiri **kode mati**:
`getDomainEventBrokerAdapter()` nol pemanggil di seluruh repo.

Yang membuat ini layak sebuah ADR: **tidak ada gerbang yang akan
menangkapnya.** Consumer FCM yang didaftarkan dengan cara paling wajar akan
menahan koneksi pool selama round-trip ke Google sambil memegang row lock, dan
mengubah tiap kegagalan jaringan menjadi rollback event — sehingga event yang
**sudah** terkirim dikirim ulang — dengan seluruh 37 gerbang hijau.

Jadi: modul `push_delivery` (ADR-0074) dengan pola lease yang sudah terbukti
tiga kali di sini (`email-dispatch`, `object-dispatch`, `purge-queue`), tiga
tabel di `sql/093`, port `PushProvider`, adapter `log`, dan dua job —
`bun run push:dispatch` serta `bun run push:queue:purge`.

Empat keputusan ikut mendarat, masing-masing karena default-nya salah:

- **Endpoint dan token adalah kredensial.** Endpoint Web Push dan token FCM
  sama-sama bearer-ish, jadi keduanya memakai disiplin tiga kolom yang sama
  dengan alamat email (`endpoint`/`_hash`/`_masked`), dengan kolom mentah
  disebut di **satu** berkas. Mask-nya memakai `origin` URL, bukan N karakter
  pertama — hitungan karakter tetap mendarat di tengah host untuk satu vendor
  dan di tengah path untuk vendor lain.
- **`subscriptionGone` adalah cabang hasil tersendiri**, bukan
  `retryable: false`. `404`/`410`/`UNREGISTERED` bukan kegagalan kirim: itu
  langganan yang melaporkan dirinya mati. Melipatnya ke "gagal, jangan ulangi"
  meninggalkan endpoint nisan yang memungut satu kegagalan permanen per pesan,
  selamanya.
- **Retensi `delegated`, bukan `generic`.** `HighVolumeTableDescriptor` tidak
  punya predikat status, jadi executor generik menghapus murni berdasarkan
  umur — diarahkan ke antrean, ia menghapus pekerjaan yang **belum terkirim**,
  dan lenyapnya terlihat persis seperti housekeeping berhasil. Dibuktikan
  terhadap Postgres nyata: dengan cutoff 400 hari ke depan, purge mengambil
  2 attempt + 1 pesan terminal dan **baris `queued` selamat**.
- **`targetPath` hanya path same-origin**, divalidasi sebelum baris ditulis.
  Baris antrean ber-URL absolut adalah open-redirect tersimpan dengan
  notifikasi sistem sebagai kendaraannya, datang membawa nama dan ikon origin
  ini sendiri.

Status modulnya **`experimental`, bukan `active`**, dan itu ditegakkan bukan
kosmetik: `tests/admin-media-page-contract.test.ts` mewajibkan tiap modul
`active` punya layar admin, TANPA pengecualian (ADR-0021), dan komentarnya
sendiri mencatat apa yang terjadi terakhir kali orang menulis carve-out. Modul
ini tidak mengambil pengecualian itu; ia mengambil status yang jujur — antrean
dan worker-nya jalan, permukaan operatornya belum ada, dan itu kesenjangan
nyata yang tutup bersama adapter di #466.

Mendarat **inert**: tanpa `PUSH_ENABLED=true` dispatcher tidak mengklaim satu
baris pun. `PUSH_PROVIDER` sengaja belum menerima `fcm`/`web_push` — menamainya
sekarang membuat deployment lolos `config:validate` lalu gagal saat resolve.
`config:validate` juga menolak `PUSH_ENABLED=true` tanpa adapter, karena tanpa
itu setiap notifikasi yang diantre langsung menjadi `failed` dengan pesan yang
hanya terlihat di buku percobaan kirim.

**FCM Web ditolak, dengan angkanya**, di ADR-0074: 45.041 B versus plafon
21.000 B per berkas, total 185.049 B versus 180.000 B, dan CSP repo ini
mengunci nol origin pihak ketiga (ADR-0029) — sementara Web Push/VAPID memberi
hasil sama dengan nol byte SDK dan nol origin baru.
