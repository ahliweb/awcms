🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0163-agent-proposed-omes-operations-always-need-a-human-approval.md)

<!-- i18n-source-hash: sha256:e698a85c3ee91e540f35ffc785c98aa91bb02a1edebd7bbfda66b6350b89b7ed -->

# ADR-0163 — Operasi OMES yang diusulkan agen selalu memerlukan persetujuan manusia

- **Status:** Diusulkan
- **Tinjauan:** memerlukan keputusan pemilik atas pertanyaan di §Pertanyaan terbuka. Hanya dokumen; tidak ada yang dibangun sebelum ADR ini Diterima dan dipecah menjadi issue.
- **Tanggal:** 2026-11-14
- **Pengambil keputusan:** @ahliweb (diusulkan, belum diputuskan)
- **Terkait:** Issue [#1336](https://github.com/ahliweb/awcms/issues/1336); prasyarat [#1335](https://github.com/ahliweb/awcms/issues/1335); [ADR-0122](0122-omes-control-center-domain-module-admission.id.md) (admisi `omes_control` dan kontrak yang dipin), [ADR-0031](0031-segregation-of-duties-conflict-enforcement.id.md) (SoD), [ADR-0049](0049-machine-credentials-and-session-introspection.id.md) dan [ADR-0092](0092-machine-credentials-may-write.id.md) (kredensial mesin dan batas tulisnya), [ADR-0134](0134-descriptor-declared-domain-event-consumers.id.md) (consumer domain event), [ADR-0143](0143-reporting-quantity-metrics-tie-safe-pages-and-booking-projections.id.md) (metrik reporting), [ADR-0144](0144-workflow-decisions-append-only-and-terminal-instances-immutable.id.md) (keputusan workflow imutabel), [ADR-0145](0145-idempotency-keys-are-scoped-per-actor-and-the-request-hash-is-keyed.id.md) (idempotensi); `ahliweb/omes` ADR-0029 (batas data AI), ADR-0032 (batas kendali multi-agen), `contracts/observability/v1/policy-decision.schema.json` (#274)

**Hanya dokumen.** ADR ini tidak mengubah modul, migrasi, path API, permission, kontrak, atau dependensi.

## Konteks

OMES menjalankan runtime agen probabilistik (Hermes Agent) di samping plane kendali host yang deterministik. Langkah berikut yang sedang dibahas adalah agen yang **mengusulkan** remediasi host — misalnya "restart gateway di server X" setelah membaca bukti `omes doctor` — yang kemudian diterima atau ditolak oleh seorang manusia. Di OMES aturannya sudah tertulis: output model adalah data, bukan otorisasi, dan `operation-request` yang bertipe adalah satu-satunya batas mutasi (OMES ADR-0032). ADR ini memutuskan di mana keputusan manusia itu berada di AWCMS dan seperti apa bentuk usulan agen di sini.

Yang ada hari ini (diverifikasi di `main` @ `ff426cc`):

- `omes_control` mencatat niat dan tidak pernah mengeksekusi apa pun di host. Operasi adalah daftar tertutup, `OMES_OPERATION_CODES` (`status`, `preflight`, `start`, `stop`, `restart`, `update`, `backup`, `rollback`), disalin byte demi byte dari kontrak OMES (`domain/operations.ts`).
- **Operasi aman disetujui otomatis saat diajukan** (`application/operation-submission.ts:152`, `approved_by` = peminta). Hanya `stop`, `rollback`, dan restore backup yang melewati `workflow-approval` (workflow key `omes_control.destructive_operation`).
- `awcms_omes_operation_requests.requested_by` selalu pengguna tenant manusia. **Tidak ada jenis pengusul** dan tidak ada kolom yang dapat menyatakan "sebuah agen meminta ini".
- Guard larangan menyetujui permintaan sendiri (`identity-access/domain/access-control.ts`) mengenal peminta; ia tidak mengenal pengusul yang berbeda dari peminta.
- Kredensial mesin hanya dapat menulis `create`/`update`, dan tidak pernah aksi high-risk (`MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS` di `identity-access/domain/machine-credential.ts`, ADR-0092). `operate` dan `rollback` adalah high-risk.
- Kontrak OMES `operation-request` hanya mengizinkan `actor.type` `user|service`. OMES `observability/v1/policy-decision.schema.json` (#274) sudah mengizinkan `agent` dan membawa `approval_ref`, tetapi tidak di-vendor di sini, dan pin yang di-vendor (`src/modules/omes-control/contracts/v1/PIN.json`, `a4026e6`, 2026-10-02) tertinggal dari `main` OMES.
- **Verdict manusia atas workflow `omes_control` hari ini tidak sampai ke baris permintaan** (#1335). Semua yang ada di ADR ini bergantung pada perbaikan itu.
- Tidak ada modul AI, tabel audit pemanggilan tool AI, maupun kode RAG atau evaluasi di repositori ini.

Ancaman yang dijawab keputusan ini: prompt injection tidak langsung dan langsung (MITRE ATT&CK v20 T1698/T1699), hasil retrieval yang diracuni (T1608.007), dan _excessive agency_ (OWASP Top 10 for LLM Applications 2025, LLM06). Agen yang dapat mengubah outputnya sendiri menjadi operasi yang dieksekusi akan mengubah masing-masing ancaman itu menjadi dampak di host.

## Keputusan

**D1 — Usulan agen adalah operation request, bukan modul baru.** Ia adalah baris di `awcms_omes_operation_requests` dengan pengusul berjenis `agent`. Tidak ada tabel kedua, tidak ada modul `ai_agent_actions`, tidak ada antrean kedua. Jalur poll worker, job, lease, hasil, dan audit tetap yang sudah ada.

**D2 — Pengusul dicatat terpisah dari peminta yang bertanggung jawab.** Dua kolom baru: `proposed_by_kind` (`human` | `agent`, default `human`) dan `proposed_by_ref` (pengenal opak agen dan sesinya, mis. id kredensial mesin ditambah id sesi agen; tidak pernah prompt, transkrip, atau output model). `requested_by` tetap berarti "principal manusia yang bertanggung jawab": untuk usulan agen, ia adalah manusia pemilik kredensial mesin yang dipakai agen (lihat §Pertanyaan terbuka Q1).

**D3 — Setiap usulan agen melewati workflow. Tidak ada yang disetujui otomatis.** Workflow key baru, `omes_control.agent_proposed_operation`, dimulai untuk setiap usulan agen, **termasuk** `status` dan `preflight`. Bila tidak ada definisi yang aktif, pengajuan ditolak dengan `409 APPROVAL_WORKFLOW_NOT_CONFIGURED`, sama seperti operasi destruktif hari ini. Verdict sampai ke baris lewat consumer settlement dari #1335; promosi menjadi job tetap di `worker-job-queue`.

**D4 — Segregation of duties mencakup pengusul.** Peminta yang bertanggung jawab atas usulan agen, dan siapa pun yang tercatat menjalankan sesi agen tersebut, tidak boleh menyetujuinya. Ini ditambahkan ke registri SoD (ADR-0031) sebagai aturan pada workflow key baru, sehingga guard yang ada yang menegakkannya, bukan pemeriksaan baru di `omes_control`.

**D5 — Aksi baru `propose` yang tidak high-risk, dapat dicapai kredensial mesin.** Permission `omes_control.deployments.propose`. `propose` membuat permintaan berstatus menunggu dan tidak lebih; ia tidak pernah dapat menyetujui, men-dispatch, atau membatalkan. Batas ADR-0092 diperluas menjadi `create`, `update`, `propose` (perubahan kode pada `MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS`, ditinjau sebagai perubahan auth). `operate`, `rollback`, dan `approve` tetap di luar jangkauan kredensial mesin.

**D6 — Usulan tidak membawa teks bebas.** Body-nya adalah bentuk tertutup yang sudah ada (`serverId`, `operation`, `deploymentId` opsional, `parameters` yang tervalidasi skema) ditambah `reasonCode` tertutup dan sejumlah terbatas `evidenceRefs` (id snapshot health, job, atau catatan bukti OMES yang ada di tenant ini). Tidak ada prosa model yang disimpan, dirender, atau diteruskan. Layar penyetuju menampilkan bukti yang dirujuk dari catatan AWCMS sendiri, bukan penjelasan agen.

**D7 — Kontrak dan pin.** Job yang di-dispatch tetap membawa `actor.type: "service"` ke OMES (AWCMS adalah layanan yang memutuskan), dan mendapat `approval_ref` ke instance workflow beserta jenis pengusul, selaras dengan OMES `policy-decision` (#274). Ini memerlukan perubahan kontrak OMES dan pin ulang (`bun run contracts:omes:sync`) sebelum implementasi; job runner OMES tetap menurunkan ulang keputusan allowlist dan persetujuannya sendiri.

**D8 — Audit.** Usulan, verdict, settlement, dan dispatch diaudit dengan correlation id yang sama, jenis dan referensi pengusul, dan tanpa prompt, transkrip, atau output model mentah (aturan `findDisallowedEvidenceKeys` yang ada berlaku).

**D9 — Metrik evaluasi adalah keputusan terpisah di kemudian hari.** Hasil evaluasi RAG dan agen (kualitas retrieval, faithfulness, persentil latensi, jumlah pemanggilan tool, tingkat keberhasilan injection, aksi tanpa persetujuan) tidak diputuskan di sini. `reporting` hari ini tidak dapat menyatakan rasio atau persentil (ADR-0143). Arah yang diharapkan adalah tampilan read-only `omes_control` yang diisi kontrak agregat yang didorong worker, mengikuti tampilan postur privasi AI; ia mendapat ADR sendiri ketika pipeline evaluasi sudah ada.

## Opsi yang dipertimbangkan

| Kriteria        | **Operation request dengan pengusul + workflow wajib (dipilih)**         | Modul baru `ai_agent_actions`                                          | Operasi aman juga disetujui otomatis untuk agen             | Agen memanggil OMES langsung, AWCMS hanya mengamati      |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| Keamanan        | Satu batas mutasi; setiap aksi agen perlu manusia; SoD mencakup pengusul | Jalur kedua ke job yang sama, dua tempat yang harus benar otorisasinya | Injection mencapai `start`/`restart`/`update` tanpa manusia | Tanpa otorisasi tenant, persetujuan, atau audit di AWCMS |
| Performa        | Satu instance workflow tambahan per usulan                               | Sama ditambah antrean kedua                                            | Paling cepat                                                | Paling cepat                                             |
| Maintainability | Memakai ulang kode pengajuan, workflow, settlement, worker, dan audit    | Menduplikasinya                                                        | Perubahan kecil, utang kebijakan besar                      | Memecah otoritas lintas repo                             |
| Skalabilitas    | Dibatasi antrean job yang ada                                            | Sama                                                                   | Sama                                                        | Tulisan agen tanpa batas                                 |
| UI/UX           | Persetujuan muncul di inbox `/admin/approvals` yang ada                  | Inbox baru                                                             | Tanpa inbox                                                 | Tidak ada                                                |
| Kompatibilitas  | Memerlukan perubahan kontrak OMES (D7)                                   | Sama                                                                   | Sama                                                        | Melanggar aturan 6 OMES ADR-0032                         |
| Jangka panjang  | Model yang sama untuk agen apa pun di masa depan, bukan hanya Hermes     | Satu modul per jenis agen                                              | Sulit diperketat kemudian                                   | Tidak dapat dibalik tanpa migrasi kepercayaan            |

## Konsekuensi

- **Positif:** agen tidak pernah dapat mengubah outputnya sendiri menjadi operasi yang dieksekusi; setiap aksi agen memiliki orang bertanggung jawab yang bernama dan penyetuju bernama yang berbeda; inbox persetujuan, jejak audit, dan jalur worker tetap tunggal.
- **Negatif / trade-off:** bahkan operasi baca yang tidak berbahaya yang diusulkan agen menunggu manusia, sehingga diagnosis berbasis agen lebih lambat; satu definisi workflow tambahan per tenant harus dipublikasikan sebelum agen dapat mengusulkan apa pun; D5 memperluas batas kredensial mesin dengan satu aksi non-high-risk, yang memerlukan review auth.
- **Netral:** permintaan yang diajukan manusia tidak berubah (`proposed_by_kind` default `human`); sisi OMES harus menerima perubahan kontrak sebelum AWCMS dapat mengirim D7.

## Garis besar implementasi (setelah diterima)

1. #1335 di-merge (consumer settlement).
2. OMES: perluas `operation-request` dengan `approval_ref` dan jenis pengusul; rilis; pin ulang di sini.
3. Migrasi: `proposed_by_kind`, `proposed_by_ref` dengan constraint CHECK; permission `omes_control.deployments.propose`; registrasi workflow key.
4. Jalur pengajuan untuk usulan agen (D3, D6), aturan SoD (D4), batas kredensial mesin (D5), audit (D8).
5. Layar persetujuan menampilkan jenis pengusul dan bukti yang dirujuk.
6. Tes: usulan agen tidak pernah `approved` tanpa keputusan manusia; pemilik yang bertanggung jawab tidak dapat menyetujui; field teks bebas ditolak; kredensial mesin tidak dapat `operate`.

## Pertanyaan terbuka untuk pemilik

- **Q1.** Siapa peminta yang bertanggung jawab atas usulan agen: manusia pemilik kredensial mesin, atau sebuah peran (mis. "pemilik agen OMES") yang ditetapkan per tenant?
- **Q2.** Apakah agen boleh mengusulkan `rollback` dan restore backup sama sekali, atau hanya operasi siklus hidup (`status`, `preflight`, `start`, `restart`, `update`, `backup`, `stop`)?
- **Q3.** Apakah satu penyetuju cukup untuk usulan agen, atau usulan agen yang destruktif perlu dua (`quorum`)?
- **Q4.** Apakah usulan agen yang tidak dijawab sebaiknya kedaluwarsa (mis. setelah 24 jam) alih-alih menunggu tanpa batas?
