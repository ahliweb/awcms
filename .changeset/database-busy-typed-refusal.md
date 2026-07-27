---
"awcms": minor
---

Buat penolakan pool database tak bisa lagi menyamar sebagai data, dan hentikan
inversi backpressure yang sudah hidup di jalur job.

`withTenant<T>(...): Promise<T>` mengembalikan `503 DATABASE_BUSY` (breaker
open / work-class saturasi) dan `409` idempotency lewat `as T` — cast yang
artinya persis "berhenti memeriksa". Header-nya menyatakan "in practice every
real call site uses `T = Response`"; itu sudah lama tidak benar. **58 berkas di
`src/`+`scripts/` yang bukan handler HTTP** (15 di antaranya `.astro`) dan 24
berkas test memakainya untuk mengambil DATA; begitu tipe-nya dijujurkan,
compiler membuktikan 30 di antaranya benar-benar membaca field dari nilai yang
bisa berupa `Response`.

Kerusakannya nyata, bukan teoretis. `purgeExpiredAuditEvents` berjanji
`Promise<number>`; di bawah work-class `maintenance` (SATU slot) ia
mengembalikan `Response`. `runBoundedBatches` berhenti "sampai satu pass
mengembalikan `count: 0`" — dan `Response` tak pernah `=== 0`, sehingga job yang
seluruh tujuannya mengalah justru menjalankan 50 pass penuh per tenant ke
database yang baru saja menolak, lalu melaporkan `totalCount` sebagai string
`"0[object Response]…"` (karena `number + Response` itu konkatenasi). Test
mutasinya mereproduksi persis output itu.

Sekarang ada dua bentuk, dan compiler yang memilihkan:

- **`withTenant(...)` → `Promise<T | Response>`.** Jalur request meneruskan
  `503`-nya apa adanya, lengkap dengan `Retry-After`; 275 pemanggilan di 204
  berkas rute yang callback-nya memang sudah mengembalikan `Response` tidak
  berubah satu baris pun (`Response | Response` itu `Response`).
- **`withTenantOrThrow<T>(...)` → `Promise<T>`.** Untuk semua yang bukan handler
  HTTP. Melempar `DatabaseBusyError` yang MEMBAWA response `503` yang sama
  (jadi kedua bentuk tak bisa menyimpang), dan kini diklasifikasi `retryable`
  oleh job runner alih-alih jatuh ke `unknown`.

Tak ada lagi satu pun `as T` di modul itu.

`db:tenant-context:check` (baru, di rantai `check`) menutup dua sisa yang tak
terlihat compiler: hasil `withTenant` yang **dibuang** (`await withTenant(...)`
sebagai statement — 503-nya lenyap tanpa jejak), dan pemanggilan dari `.astro`,
yang tak pernah dibaca `tsc --noEmit`. Gate itu langsung menemukan tiga
pembuangan nyata di jalur auth: dua di antaranya melewatkan audit event
`sso_account_linked`/`mfa_challenge_issued` sambil tetap menjawab seolah sudah
tertulis.
