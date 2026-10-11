🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:87bee03b6a778add0c121aa0a6d51956d937f697cbfa9f169292c1539b505a15 -->

<!-- i18n-source-hash: sha256:pending -->

# `booking`

**Resource, unit kapasitas, jadwal, dan reservasi** generik untuk apa pun yang
menyewakan waktu, ruang, atau kapasitas, termasuk menginap per malam (Issue #937,
[ADR-0131](../../../docs/adr/0131-generic-booking-module-admission.md), diubah oleh
[ADR-0135](../../../docs/adr/0135-day-granularity-stays-admitted-into-booking-v1.md)).
Paket desain lengkapnya adalah [`docs/awcms/booking.md`](../../../docs/awcms/booking.md);
berkas ini adalah peta kodenya.

## Irisan yang sudah ada

Fondasi (Issue #937): descriptor (`experimental`), skema (`sql/180`), katalog izin
(`sql/181`), mesin status reservasi murni, literal guard, dan nama audit event.

Ketersediaan (Issue #938): jadwal, penutupan, dan pengecualian, malam yang
diblokir (`sql/186`), kalkulasi ketersediaan murni, dan route di
`/api/v1/booking/` (`availability`, `schedules`, `schedule-exceptions`).
**Belum ada:** allocator dan penulisan reservasi, penulisan blok, channel
AsyncAPI, layar admin, dan proyeksi reporting (Issue #939 sampai #941).

## Semantik waktu, di satu tempat

- Setiap instan berupa UTC dan setiap interval setengah-terbuka `[start, end)`;
  instan request tanpa offset adalah 400.
- Jadwal ditulis dalam waktu dinding lokal pada zona IANA. `resolveLocalInstant`
  (`domain/booking-time.ts`) adalah SATU fungsi gap/fold (RFC 5545 bagian 3.3.5):
  waktu lokal yang tidak ada memakai offset sebelum gap, yang ambigu memakai
  kemunculan pertamanya.
- Sebuah stay adalah interval tanggal lokal; malam adalah `check_out - check_in`
  dalam tanggal. Jam check-in dan check-out hanya menurunkan instan tampilan dan
  tidak pernah masuk uji tumpang-tindih atau hitungan malam. Pergantian di hari
  yang sama diizinkan.
- Blok adalah pengecualian keras (tidak ada yang menimpanya); pengecualian
  `closed` adalah penutupan lunak (`OUTSIDE_SCHEDULE`, dapat ditimpa).
  Ketersediaan tidak mengklaim apa pun: exclusion constraint allocator, bukan
  pembacaan ini, yang mencegah double booking.

## Aturan yang dipegang database

- **Double-booking tak bisa direpresentasikan.** Dua exclusion constraint GiST
  parsial pada `awcms_booking_resource_allocations`, satu atas instan (mode slot)
  dan satu atas tanggal (mode stay), keduanya hanya atas baris yang masih hidup.
  Membutuhkan ekstensi tepercaya `btree_gist` (booking.md bagian 8.2).
- **Mesin status adalah trigger.** `awcms_booking_reservations_update_guard`
  hanya mengizinkan transisi yang sah dan, per transisi, hanya kolom yang boleh
  berubah. `domain/booking-reservation-state.ts` adalah tabel yang sama sebagai
  fungsi murni; tes integrasi memastikan keduanya sepakat untuk setiap pasangan status.
- **Riwayat bersifat append-only.** Event dan item reservasi menolak UPDATE dan
  DELETE lewat trigger dan privilege yang dicabut; tidak ada yang pernah dihapus.
- **Tanpa uang, tanpa id produk, tanpa nama pelanggan** di tabel mana pun
  (booking.md bagian 10.2); sebuah tes membaca `information_schema` untuk menjaganya.
- **RLS `ENABLE` + `FORCE`** dan foreign key komposit `(tenant_id, id)` pada setiap tabel.

## Tata letak

| Path                                   | Isinya                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `module.ts`                            | Descriptor: 32 izin, `dataLifecycle` dan `subjectData` untuk tabel-tabelnya             |
| `domain/booking-reservation-state.ts`  | Mesin status reservasi sebagai fungsi murni (tanpa I/O, pemanggil memberi jam database) |
| `domain/booking-permissions.ts`        | Objek guard literal untuk `authorizeInTransaction` (dipakai mulai Issue #938)           |
| `domain/booking-audit.ts`              | Nama dan severity audit event                                                           |
| `domain/booking-time.ts`               | Zona, aritmetika tanggal, dan resolusi gap/fold RFC 5545 yang murni                     |
| `domain/booking-schedule.ts`           | Skema rules tertutup, pemilihan jadwal, ekspansi ke jendela UTC, penutupan (murni)      |
| `domain/booking-availability.ts`       | Ketersediaan slot dan evaluasi stay yang murni (tanpa I/O, tanpa jam)                   |
| `domain/booking-validation.ts`         | Validasi request ketat (RFC 3339 beroffset, zona IANA)                                  |
| `domain/booking-staff-availability.ts` | Seam StaffAvailabilityConsumer no-op yang dihubungkan Issue #949                        |
| `application/*-directory.ts`           | Satu-satunya kode yang membaca atau menulis baris (jam database, per tenant, savepoint) |

Belum ada di skema dan dicatat sebagai tindak lanjut: `service_requirements` dan
`staff_assignments` (booking.md bagian 4). `resource_blocks` hadir bersama
Issue #938, tetapi baris allocation-nya (agar exclusion constraint stay juga
menahan blok terhadap reservasi) dan penulisnya hadir bersama allocator (#939);
sampai saat itu ketersediaan membaca blok secara langsung.

Tindak lanjut yang dicatat audit keamanan fondasi: handler transisi pada #939
dan #940 wajib menulis tepat satu event riwayat per transisi (database belum
mengikat perubahan status ke baris event), dan tabel append-only sebaiknya juga
menolak TRUNCATE lewat trigger (kini hanya privilege yang dicabut yang
menahan role runtime).
