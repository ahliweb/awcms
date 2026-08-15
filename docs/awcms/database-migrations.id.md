🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](database-migrations.md)

<!-- i18n-source-hash: sha256:429043b4f4496858cc18de4800001bb92f736d025af1107a2e655f7101de17ac -->

# Database Migration Runner

> **Status dokumen (AWCMS).** Mekanisme runner migrasi ini diwarisi
> langsung dari base teknis `awcms-mini` (Issue 0.2 di repo asal) dan
> belum diadaptasi/diverifikasi ulang di repo AWCMS — belum ada migrasi
> domain ERP yang ditulis. Konvensi di bawah adalah standar yang berlaku
> begitu migration pertama modul ERP ditambahkan.

Dokumen ini mencatat runner migrasi PostgreSQL AWCMS.

## Langkah 0 — ambil DAN verifikasi backup

Berlaku untuk setiap environment bersama — produksi, dan environment
kedua apa pun yang seseorang dirikan di sampingnya. Bukan
saran, melainkan langkah pertama: migrasi di repo ini **forward-only**
(tidak ada `down`), jadi satu-satunya jalur pembatalan yang nyata adalah
restore. Backup yang belum pernah diuji-restore bukan jalur pembatalan —
ia hanya berkas.

```bash
# 1. ambil backup (custom format + sidecar sha256, diverifikasi saat itu juga)
DATABASE_URL=<url owner/privileged> \
BACKUP_DIR=/var/backups/awcms \
./deploy/backup/backup-postgres.sh

# 2. buktikan dump itu benar-benar bisa di-restore — drill verify-only:
#    restore ke database sekali-pakai, diperiksa, lalu di-DROP.
#    Tanpa --target skrip ini TIDAK PERNAH menyentuh database live.
DATABASE_URL=<url owner/privileged> \
./deploy/backup/restore-postgres.sh /var/backups/awcms/awcms_<db>_<timestamp>.dump
```

Langkah 2 tidak opsional. `backup-postgres.sh` hanya membuktikan berkasnya
terbaca; `restore-postgres.sh` yang membuktikan isinya kembali menjadi
database — termasuk bahwa tabel ber-`FORCE ROW LEVEL SECURITY` selamat
melewati round-trip. Isolasi tenant yang hilang saat restore adalah
kegagalan senyap: semuanya tampak sehat, tak ada satu pun tenant yang
terpisah.

Database PostgreSQL di sini adalah container yang dikelola Coolify tanpa
port ter-publish, jadi kedua skrip dijalankan sebagai container one-shot
yang berbagi network namespace container DB — pola yang sama persis
dengan menjalankan migrasi itu sendiri (lihat
[`environments.md`](environments.md) §Menjalankan migrasi, dan header
komentar di masing-masing skrip untuk perintah `docker run` lengkapnya).

Catat nama berkas dump, `sha256`-nya, dan waktu drill di catatan deploy —
itulah bukti yang diminta
[`production-preflight-runbook.md`](production-preflight-runbook.md)
Stage 2 sebelum `--backup-verified` boleh dipakai.

> Enkripsi at-rest dan manifest bertanda tangan HMAC yang disebut runbook
> itu **belum ada**; kedua skrip menolak jalan (bukan diam-diam
> mengabaikan) bila variabel kuncinya diset, supaya tak ada yang mengira
> dump polos itu terenkripsi.

## Perintah

```bash
DATABASE_URL=postgres://awcms:awcms_password@localhost:5432/awcms bun run db:migrate
```

`DATABASE_URL` wajib berasal dari environment. Jangan commit `.env`, dump database, atau kredensial production.

## Kontrak runner

- Runtime memakai Bun melalui `bun scripts/db-migrate.ts`.
- Driver memakai `Bun.SQL`, bukan `pg` atau adapter Node.js.
- File migrasi dibaca dari `sql/` dan diurutkan berdasarkan nama file.
- Nama file wajib mengikuti `NNN_awcms_<area>_<description>.sql`.
- Runner memastikan tabel `awcms_schema_migrations` tersedia.
- Migration yang sudah tercatat akan di-skip.
- Checksum SHA-256 disimpan untuk setiap migration yang applied.
- Jika migration yang sudah applied berubah, runner berhenti dan meminta migration baru.
- Setiap migration baru dijalankan dalam transaction runner; wrapper `BEGIN; ... COMMIT;` luar boleh ada pada file lama dan akan dilepas sebelum eksekusi.
- Runner menyetel `lock_timeout = 5s` dan `statement_timeout = 15min` pada sesinya sendiri, tepat setelah advisory lock diambil — bukan tanggung jawab operator di command line. `lock_timeout` mencegah satu DDL yang menunggu `ACCESS EXCLUSIVE` mengantrikan seluruh request di belakangnya (cara paling umum sebuah `ALTER TABLE` "cepat" menjatuhkan situs); `statement_timeout` memberi batas atas pada backfill yang meleset. Migration yang memang butuh lebih lama menyatakannya sendiri dengan `SET LOCAL statement_timeout` di dalam berkasnya, sehingga niat itu terbaca di tempat reviewer melihatnya.
- Error menghentikan proses dengan exit code non-zero.
- Pesan error tidak mencetak nilai `DATABASE_URL`.

## Alur

```mermaid
flowchart TD
  A[Baca sql/*.sql] --> B[Validasi nama file]
  B --> C[Hitung checksum]
  C --> D[Ambil advisory lock]
  D --> E{Sudah tercatat?}
  E -- Ya --> F{Checksum sama?}
  F -- Ya --> G[Skip]
  F -- Tidak --> H[Stop non-zero]
  E -- Tidak --> I[Jalankan dalam transaction]
  I --> J[Catat name + checksum]
  J --> K[Lanjut]
  G --> K
```

## Aturan membuat migration baru

1. Tambahkan file baru di `sql/` dengan nomor berikutnya.
2. Jangan edit migration yang sudah pernah applied di environment bersama atau production.
3. Jangan menaruh secret, dump data customer/finansial/payroll, atau nilai environment nyata di SQL.
4. Schema tenant-scoped (termasuk entitas ERP: ledger, inventory, procurement, manufacturing, HR/payroll) wajib mengikuti standar PostgreSQL + RLS pada dokumen governance/ADR terkait (lihat ADR-0001 dan ADR foundation lain yang akan menyusul untuk RLS/RBAC-ABAC).
5. Resource yang bisa dihapus wajib memakai kolom soft delete sesuai standar ADR soft-delete/immutability yang diwarisi dari base.
</content>
