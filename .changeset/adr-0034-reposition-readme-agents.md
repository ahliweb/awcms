---
"awcms": patch
---

docs(governance): reposisi README/AGENTS & indeks ADR ke ADR-0034 (keluarga = template dipakai-langsung)

Menyelaraskan dokumen pintu-depan dengan ADR-0034 (Fase 4a, item d + audit rujukan ADR ERP):

- README (`.md`/`.id.md`) & AGENTS.md: narasi "repo ekstensi/turunan terpisah" → "template dipakai-langsung, modul domain (termasuk ERP) hidup langsung di `src/modules/`"; menghapus posisi jalur-turunan sebagai jalur aktif dan menandai panduan lama `derived-application-guide.md` DEPRECATED.
- Header status ADR yang di-supersede ADR-0034: 0015 & 0022 → Superseded; 0013, 0014, 0025 → Accepted dengan catatan "jalur aplikasi-turunan di-supersede oleh ADR-0034" (bagian load-bearing base tetap berlaku).
- Indeks ADR (`docs/adr/README.md`/`.id.md`): kolom Status kelima ADR itu diperbarui + framing folder direposisi dari ADR-0022 ke ADR-0034; regenerasi i18n-source-hash EN.

ADR-0020 (kontrak kesiapan ERP) sengaja tidak disentuh — tetap load-bearing dan tidak di-supersede.
