# ADR-0004 — RBAC + ABAC default-deny sebagai baseline akses

- **Status:** Accepted
- **Tanggal:** 2026-07-05
- **Terkait:** `docs/awcms/17_default_seed_rbac_abac.md`, `docs/awcms/10_template_kode_coding_standard.md` (§ABAC guard)

## Konteks

Kontrol akses berbasis peran (RBAC) saja tidak cukup untuk aturan yang bergantung atribut (kepemilikan resource, scope office, self-approval, kondisi lingkungan). Model akses harus aman secara default dan dapat diaudit.

## Keputusan

Kami memutuskan memakai **RBAC + ABAC** dengan prinsip **default deny** dan **deny overrides allow**. RBAC memberi baseline permission per peran (`module.activity.action`); ABAC menyaring lebih lanjut berdasarkan atribut. Semua endpoint non-public wajib melewati ABAC guard. Setiap keputusan **deny high-risk** dicatat di decision log. RLS tetap wajib sebagai pertahanan berlapis (lihat ADR-0003).

## Konsekuensi

- **Positif:** aman secara default; kebijakan kompleks (scope, self-approval, masking) dapat dinyatakan sebagai policy; keputusan akses auditable.
- **Trade-off:** setiap endpoint butuh deklarasi akses; evaluator + policy store menambah kompleksitas.
- **Netral:** seed default (peran, permission, policy) dibuat saat setup wizard.

## Alternatif yang dipertimbangkan

- **RBAC saja** — ditolak: tidak menangani aturan beratribut.
- **Default allow + blacklist** — ditolak: melanggar prinsip aman-secara-default.
