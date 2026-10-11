🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:9bc11e3784ae16502e65f869d9b8aba0cd15ad1c8ac43a399c9b38620b03a74b -->

<!-- i18n-source-hash: sha256:pending -->

# `booking`

**Resource, unit kapasitas, jadwal, dan reservasi** generik untuk apa pun yang
menyewakan waktu, ruang, atau kapasitas, termasuk menginap per malam (Issue #937,
[ADR-0131](../../../docs/adr/0131-generic-booking-module-admission.md), diubah oleh
[ADR-0135](../../../docs/adr/0135-day-granularity-stays-admitted-into-booking-v1.md)).
Paket desain lengkapnya adalah [`docs/awcms/booking.md`](../../../docs/awcms/booking.md);
berkas ini adalah peta kodenya.

## Ini hanya irisan fondasi

Ada: descriptor (`experimental`, tanpa route, tanpa navigasi), skema (`sql/180`),
katalog izin (`sql/181`), mesin status reservasi murni, literal guard, dan nama
audit event. **Belum ada:** allocator, pencarian ketersediaan, route HTTP, path
OpenAPI, channel AsyncAPI, layar admin, dan proyeksi reporting (Issue #938
sampai #941).

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

| Path                                  | Isinya                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `module.ts`                           | Descriptor: 32 izin, `dataLifecycle` dan `subjectData` untuk tabel-tabelnya             |
| `domain/booking-reservation-state.ts` | Mesin status reservasi sebagai fungsi murni (tanpa I/O, pemanggil memberi jam database) |
| `domain/booking-permissions.ts`       | Objek guard literal untuk `authorizeInTransaction` (dipakai mulai Issue #938)           |
| `domain/booking-audit.ts`             | Nama dan severity audit event                                                           |

Belum ada di skema dan dicatat sebagai tindak lanjut: `service_requirements`,
`resource_blocks`, dan `staff_assignments` (booking.md bagian 4).

Tindak lanjut yang dicatat audit keamanan fondasi: handler transisi pada #939
dan #940 wajib menulis tepat satu event riwayat per transisi (database belum
mengikat perubahan status ke baris event), dan tabel append-only sebaiknya juga
menolak TRUNCATE lewat trigger (kini hanya privilege yang dicabut yang
menahan role runtime).
