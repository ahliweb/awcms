# `push_delivery`

Outbox transaksional untuk notifikasi push perangkat (epic #463, ADR-0074).

Modul ini **mengirimkan** notifikasi yang orang lain putuskan untuk dikirim. Ia tidak punya pendapat tentang apa yang layak dinotifikasikan — sama seperti `email`, yang juga infrastruktur generik dan bukan fitur "kirim struk".

## Kenapa outbox KEDUA

`awcms_domain_events` sudah punya dispatcher, DLQ, dan replay, jadi menggantungkan push padanya adalah langkah pertama yang wajar. Ia tidak bisa:

- `domain-event-runtime/application/dispatch-domain-events.ts` menyatakan di header-nya bahwa CLAIM + handler + FINALIZE berjalan dalam **satu** transaksi, **sengaja**, dan handler dipanggil di dalamnya;
- provider push adalah panggilan HTTP eksternal, dan **ADR-0006 melarangnya di dalam transaksi DB**;
- `broker-adapter-port.ts` sudah menuliskan konsekuensinya di muka — consumer out-of-transaction "would need the lease-based shape back" — dan port itu sendiri nol pemanggil.

Yang membuat ini perlu ditulis, bukan sekadar diketahui: **tidak ada gerbang yang akan menangkap kesalahannya.** Consumer FCM yang didaftarkan dengan cara paling wajar akan menahan koneksi pool selama round-trip ke Google sambil memegang row lock, dan mengubah tiap kegagalan jaringan menjadi rollback event — sehingga event yang **sudah** terkirim dikirim ulang — dengan seluruh 37 gerbang hijau.

## Bentuknya

Tiga fase, disalin dari `email/application/email-dispatch.ts`:

1. **CLAIM** — satu transaksi pendek membalik baris `queued`/`retry_wait` yang jatuh tempo menjadi `sending` (`FOR UPDATE SKIP LOCKED`), memakai ulang `next_attempt_at` sebagai batas-waktu klaim. Tidak ada kolom lease baru. Lease-nya **dibaca**, bukan hanya ditulis: baris `sending` yang lease-nya kedaluwarsa diklaim ulang oleh pass berikutnya, dan itulah yang mencegah worker yang mati di tengah jalan meninggalkan baris di limbo permanen.
2. **SEND** — memanggil `PushProvider` **di luar** transaksi apa pun.
3. **FINALIZE** — satu transaksi pendek per baris: `sent`, atau `retry_wait` dengan backoff, atau `failed` terminal. Tiap percobaan tercatat.

Trade-off yang diterima sama dengan kedua saudaranya: crash di jendela sempit setelah provider menerima tetapi sebelum FINALIZE bisa menghasilkan satu notifikasi ganda. Untuk push itu satu banner berulang — jelas lebih baik daripada notifikasi yang tersangkut selamanya.

## Yang dilakukan dispatcher ini dan tidak dilakukan milik email

Ia bisa **menonaktifkan targetnya**. Push service yang menjawab `404`/`410`, atau FCM yang menjawab `UNREGISTERED`, bukan kegagalan kirim dan bukan gangguan provider — itu langganan yang melaporkan dirinya mati. `subscriptionGone` karena itu cabang hasil tersendiri, bukan `retryable: false`: melipatnya ke sana akan meninggalkan endpoint nisan yang memungut satu kegagalan permanen per pesan, selamanya.

## Endpoint adalah kredensial

Endpoint Web Push dan token registrasi FCM keduanya bearer-ish. Keduanya memakai disiplin tiga kolom yang sama dengan alamat email (`endpoint` / `endpoint_hash` / `endpoint_masked`), dan kolom mentahnya disebut di **satu** berkas: `application/subscription-directory.ts`. Aturan itu bisa dipegang justru karena hanya satu berkas yang menyebutnya.

## Perilaku saat mati

Tanpa `PUSH_ENABLED=true`, `dispatchPushQueue` **tidak mengklaim satu baris pun** dan tidak pernah menyentuh provider. Itu aturan feature-flag yang sudah dipakai `email`, dan yang membuat `bun run push:dispatch` aman dijadwalkan di profil deployment mana pun termasuk offline/LAN.

`bun run push:queue:purge` sebaliknya berjalan **tanpa memedulikan** flag itu: deployment yang mematikan push tetap punya baris dari masa ia menyala, dan justru itu baris yang tak akan pernah dibersihkan apa pun.

## Retensi: `delegated`, bukan `generic`

`HighVolumeTableDescriptor` membawa `cursorColumn` dan **tidak** membawa predikat status, jadi executor generik menghapus murni berdasarkan umur. Diarahkan ke sebuah antrean, itu menghapus baris yang **masih menunggu dikirim** — dan lenyapnya terlihat persis seperti housekeeping yang berhasil. Setiap DELETE di `application/push-queue-purge.ts` menyebut status terminal secara eksplisit, dan cursor-nya `updated_at` (saat baris berhenti bergerak), bukan `created_at`.

Ketiganya dihapus dalam urutan FK — attempts, messages, subscriptions — karena masing-masing anak dari berikutnya.

## Yang BELUM ada

- **Adapter nyata.** Hanya `log` yang ada. FCM HTTP v1 dan Web Push/VAPID mendarat di #466. `PUSH_PROVIDER` sengaja belum menerima `fcm`/`web_push`: menamainya sekarang akan membuat deployment lolos validasi lalu gagal saat resolve.
- **Permukaan HTTP.** Mendaftarkan dan mencabut langganan lewat API, plus layar admin, mendarat bersama adapter-nya. Sampai itu `enqueuePushToRecipients` belum punya pemanggil produksi — kesenjangan yang dicatat di ADR-0074 §Konsekuensi alih-alih dibiarkan ditemukan.
- **FCM Web (SDK browser).** Ditolak, dengan angkanya, di ADR-0074 §Yang DITOLAK.
