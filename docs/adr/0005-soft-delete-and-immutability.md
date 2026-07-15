# ADR-0005 — Soft delete untuk master/config, immutability untuk data posted

- **Status:** Accepted
- **Tanggal:** 2026-07-05
- **Terkait:** `docs/awcms/04_erd_data_dictionary.md`, `docs/awcms/10_template_kode_coding_standard.md` (§Soft delete helper)

## Konteks

Menghapus baris secara fisik menghilangkan jejak audit dan memutus referensi. Sebaliknya, data yang mewakili kejadian yang sudah terjadi (mis. transaksi yang di-posting oleh aplikasi turunan) tidak boleh diubah retroaktif.

## Keputusan

Kami memutuskan dua aturan komplementer:

1. **Soft delete** wajib untuk resource master/config/draft yang tenant-scoped: isi `deleted_at`, `deleted_by`, `delete_reason`; query list/detail default menyaring `deleted_at IS NULL`; restore/purge adalah aksi high-risk (butuh permission, diaudit).
2. **Immutability** untuk data yang sudah posted/append-only (bila aplikasi turunan memilikinya): koreksi lewat reversal/adjustment sebagai baris baru, bukan overwrite/delete. Audit log, security event, dan sync conflict juga tidak di-soft-delete.

## Konsekuensi

- **Positif:** jejak audit utuh, data dapat dipulihkan, referensi tidak putus, koreksi transparan.
- **Trade-off:** query wajib menyertakan filter soft delete; butuh kolom & index tambahan; purge butuh jalur retention/legal terpisah.
- **Netral:** partial unique index `WHERE deleted_at IS NULL` untuk business key yang boleh dipakai ulang setelah diarsipkan.

## Alternatif yang dipertimbangkan

- **Hard delete di mana-mana** — ditolak: menghancurkan audit dan integritas referensial.
- **Immutability untuk semua tabel** — ditolak: master/config wajar berubah; hanya data kejadian yang immutable.
