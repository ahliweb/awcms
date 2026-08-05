---
"awcms": patch
---

Menutup celah C12 (standar §9): enam ADR ber-status `Accepted` tanpa satu baris kode (0016 organization_structure, 0017 document_infrastructure, 0018 data_exchange, 0019 integration_hub, 0020 kontrak ERP-extension yang berkas `_shared`-nya sudah dihapus, 0021 reference_data) kini ber-status jujur `Accepted (belum diimplementasikan)` dengan catatan bertanggal, indeks ADR dwibahasa ikut diperbarui, dan gerbang murni baru `tests/adr-implementation-status.test.ts` mengikat status itu ke keberadaan artefak yang dijanjikan DUA ARAH: artefak tidak ada → kualifikasi wajib; artefak mendarat → status wajib kembali `Accepted` polos; entri peta yang mati (ADR hilang/superseded) ikut gagal; dan kualifikasi tidak boleh dipakai di luar peta.
