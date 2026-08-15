🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0052-idn-region-dataset-lifecycle-is-an-operator-job.md)

<!-- i18n-source-hash: sha256:a9edf5fc9f26614b6b1bf02a1d52153338a9d2a243db6a11fe008976a7656907 -->

# ADR-0052 — Aktivasi/rollback dataset wilayah adalah pekerjaan operator, bukan endpoint tenant

- **Status:** Accepted
- **Tanggal:** 2026-08-01
- **Pengambil keputusan:** @ahliweb
- **Menyempurnakan:** [ADR-0046](0046-idn-admin-regions-module-admission.md) (admisi modul `idn_admin_regions`) — mencabut permukaan HTTP untuk dua aksi lifecycle-nya, sisanya tetap berlaku
- **Terkait:** ADR-0051 (yang mencatat temuan ini — PR #321, belum ter-merge saat ADR ini ditulis, jadi dirujuk tanpa tautan agar `check:docs` tidak memerahkan tautan ke berkas yang belum ada), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (kredensial mesin baca-saja), [ADR-0048](0048-frontend-role-split-awcms-astro-internal-admin.md) (di-supersede ADR-0051)

## Konteks

ADR-0051 §Konteks mencatat sebuah temuan terbuka, dan ADR ini menutupnya.

`idn_admin_regions` mengapalkan dua aksi lifecycle sebagai endpoint HTTP:

| Endpoint                                          | Permission                            |
| ------------------------------------------------- | ------------------------------------- |
| `POST /api/v1/idn-regions/datasets/{id}/activate` | `idn_admin_regions.dataset.configure` |
| `POST /api/v1/idn-regions/datasets/rollback`      | `idn_admin_regions.dataset.restore`   |

Keduanya mengganti **dataset yang dilayani ke SELURUH tenant** — tabelnya global, tanpa `tenant_id`, tanpa RLS. Tetapi `sql/081` men-seed kedua permission ke katalog ABAC **global**, dan `POST /api/v1/setup/initialize` memberikan seluruh katalog ke role `owner` setiap tenant baru (owner = 197/197). Jadi **owner sebuah tenant biasa memegang izin untuk mengganti data yang dilayani ke tenant lain.**

ADR-0048 mencoba menahan ini dengan memindahkan _layar_-nya ke repo lain. Itu tidak pernah menahan apa pun: ABAC mengevaluasi permission, bukan asal-usul frontend, dan endpoint-nya menerima `curl` dari mana saja.

### Kenapa "wajibkan kredensial mesin" ditolak — meski sempat jadi kandidat utama

Kandidat pertama adalah menggerbangi keduanya pada kredensial mesin ADR-0049. Itu **tidak bisa dilakukan tanpa memperburuk keadaan**:

```ts
// identity-access/domain/machine-credential.ts
export const MACHINE_CREDENTIAL_ALLOWED_ACTIONS: ReadonlySet<AccessAction> =
  new Set<AccessAction>(["read"]);
```

Kredensial mesin **hanya boleh `read`** (ADR-0049 §3), dan `access-guard.ts` menolak selainnya dengan `machine_credential_readonly`. `activate` butuh `configure`, `rollback` butuh `restore` — keduanya tulis. Menggerbangi keduanya pada kredensial mesin berarti **melebarkan allow-list itu**, dan komentar di sumbernya sudah memperingatkan alasannya:

> "A leaked build token must not be able to change anything… Widening this set needs its own ADR: every addition is a new class of thing a stolen token can do."

Hasil akhirnya: token build yang bocor bisa mengganti dataset wilayah untuk seluruh tenant. Itu **lebih buruk** dari bug yang sedang diperbaiki.

Kredensial mesin juga bukan mekanisme yang tepat secara konseptual: [ADR-0050](0050-bff-session-handoff-code.md) memberi layar internal sebuah **sesi manusia** lewat kode handoff, bukan identitas mesin.

### Preseden yang sudah ada di modul ini sendiri

ADR-0046 §5 sudah menjawab pertanyaan yang sama untuk aksi ketiga modul ini — import:

> Import is deliberately ABSENT from this catalog: it is a worker job (`bun run idn-regions:import`) running as `awcms_worker`, never an HTTP action, so there is no request-time subject for an ABAC guard to evaluate. Seeding a permission for it would advertise a surface that does not exist.

Aktivasi dan rollback berada di **kelas yang persis sama**: operasi terhadap data referensi global, dijalankan operator platform, tanpa subjek tenant yang masuk akal untuk dievaluasi.

## Keputusan

Kami memutuskan **aktivasi dan rollback dataset wilayah menjadi pekerjaan operator (CLI job), dan permukaan HTTP-nya dihapus**:

1. `POST /api/v1/idn-regions/datasets/{id}/activate` dan `POST /api/v1/idn-regions/datasets/rollback` **dihapus** (bukan dinonaktifkan).
2. Digantikan `bun run idn-regions:activate -- --dataset <code|id>` dan `bun run idn-regions:rollback`, keduanya **dry-run secara default** dan hanya menulis dengan `--commit` — pola yang sama dengan `idn-regions:import`.
3. Permission `idn_admin_regions.dataset.configure` dan `.restore` **dicabut** dari katalog ABAC dan dari role mana pun yang sudah memegangnya (`sql/084`), dan dihapus dari `module.ts`.

Tersisa dua permission untuk modul ini: `region.read` dan `dataset.read` — keduanya benar-benar baca, benar-benar dievaluasi per-tenant, dan aman dipegang owner tenant.

> **Aturan umum yang ditegakkan keputusan ini** (ADR-0051 §Keputusan butir 2): aksi yang efeknya melintasi batas tenant tidak boleh masuk katalog yang di-seed ke role tenant. Bila aksi seperti itu tidak punya subjek platform untuk dievaluasi, ia bukan endpoint — ia pekerjaan operator.

## Konsekuensi

- **Positif:**
  - Celah lintas-tenant **hilang**, bukan dijaga. Tidak ada permukaan HTTP untuk disalahgunakan dan tidak ada permission tenant yang memberi wewenangnya.
  - Tidak ada primitive otorisasi baru yang harus dirancang, diuji, dan dipelihara.
  - Ketiga aksi lifecycle modul ini (import, activate, rollback) akhirnya konsisten: semuanya job operator, semuanya dry-run-by-default, semuanya berjalan sebagai `awcms_worker`.
  - Menghapus permission yang tak lagi punya endpoint mencegah **latent-authz trap** kebalikannya: permission yang di-seed tapi tak berarti apa-apa.
- **Negatif / trade-off yang diterima:**
  - **Jejak audit `awcms_audit_events` untuk kedua aksi ini hilang.** Ini biaya nyata dan tidak disembunyikan. Alasannya: `recordAuditEvent` **tenant-scoped**, sedangkan aksi ini global — baris audit yang lama masuk ke log tenant yang kebetulan owner-nya menekan tombol, yang menyesatkan (ia menyiratkan aksi milik tenant itu), dan tak terlihat oleh tenant lain yang justru ikut terdampak. `idn-regions:import` sudah tidak menulis audit karena alasan yang sama.
    Yang tetap ada sebagai bukti: kolom `status`/`activated_at`/`activated_by` pada `awcms_idn_region_datasets` sendiri (riwayat transisi ada di baris datanya), plus log eksekusi CLI/CI. Audit lintas-tenant yang benar butuh log global yang belum ada di base ini — dicatat sebagai follow-up, bukan diklaim selesai.
  - **Breaking change kontrak API**: dua path hilang dari OpenAPI. Diterima karena **nol konsumen** — tidak ada layar di repo ini yang memanggilnya, `awcms-astro` belum punya layar admin sama sekali, dan pencarian repo tidak menemukan pemanggil.
  - Aktivasi kini butuh akses shell ke deployment, bukan browser. Itu memang maksudnya.
- **Netral:**
  - `dataset.read` dan `region.read` tidak berubah — lookup wilayah dan daftar versi dataset tetap endpoint tenant biasa.
  - Bila kelak layar operator platform sungguh dibutuhkan, ADR-0051 §Keputusan sudah menetapkan syaratnya (gerbang platform-scoped, di luar katalog tenant). ADR ini tidak menghalanginya — ia hanya menolak mengapalkan permukaannya sebelum gerbangnya ada.

## Alternatif yang dipertimbangkan

- **Gerbang kredensial mesin** — ditolak; lihat §Konteks. Membutuhkan pelebaran allow-list baca-saja ADR-0049 dan membuat token build yang bocor bisa mengganti dataset global.
- **Deny-list `PLATFORM_SCOPED_ACTIONS` di chokepoint guard** — ditolak. Permission tetap terlihat dimiliki owner sementara selalu ditolak; itu tepat bentuk "aksi yang tak pernah bisa dipakai siapa pun" yang repo ini perlakukan sebagai jebakan, dan ia menambah cabang pada chokepoint otorisasi demi satu modul.
- **Cabut permission-nya saja, biarkan endpoint-nya** — ditolak. Endpoint yang secara desain selalu 403 adalah permukaan mati yang tetap harus dipelihara, didokumentasikan, dan dipindai — dan pembaca berikutnya akan "memperbaikinya" dengan men-seed ulang permission-nya.
- **Bangun konsep platform-operator sekarang** — ditunda, bukan ditolak. Ia primitive otorisasi baru (subjek, cara login, interaksi dengan RLS dan decision log) yang layak ADR-nya sendiri. Menunda **tidak** membiarkan celahnya terbuka, karena keputusan di atas sudah menutupnya.
