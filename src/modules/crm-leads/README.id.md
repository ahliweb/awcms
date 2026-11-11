🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:b2727c2da99830ea8618f787682c557d7e1448f67fe5e2d3ff0b5a5a0760ee8a -->

# `crm_leads`

**Pipeline lead/prospek** yang dapat dipakai ulang (Issue #1166, [ADR-0153](../../../docs/adr/0153-reusable-lead-prospect-pipeline-is-a-pre-customer-context-that-never-owns-the-customer.id.md)). Konteks **pra-pelanggan**: modul ini hanya memiliki lead. Ia tidak pernah memiliki pelanggan (hanya `external_customer_ref` opak yang ditulis oleh konversi), tidak pernah membuat profil `profile_identity`, tidak pernah menyimpan atau menyimpulkan consent, tidak mengirim apa pun, dan tidak mengimpor apa pun dari produk hilir.

- **Mati di tiga tingkat**: `CRM_LEADS_ENABLED` (deployment, `503` setelah otorisasi), Module Management (per tenant), dan sakelar tenant milik modul (`PATCH /api/v1/crm-leads/settings`, default mati; setiap penulisan lead, termasuk soft delete dan restore, menjawab `409 CRM_LEADS_TENANT_DISABLED`; anonimisasi penghapusan adalah satu-satunya pengecualian, sehingga permintaan subjek data tetap bisa dijawab setelah pengendali mematikan modul).
- **Katalog tahap berversi**: pipeline punya revisi yang immutable (tahap dengan kunci dan nama pilihan tenant serta kategori TERTUTUP `new`, `working`, `qualified`, `converted`, `lost`, `disqualified`; edge yang diizinkan dengan guard dari himpunan tertutup `owner_assigned`, `contact_point_present`, `reason_required`). Database menolak perubahan apa pun pada revisi terbit. Revisi yang menghapus tahap berisi lead wajib membawa peta `stageMigrations`; setiap lead yang dipindah mendapat transisi `stage_migrated`. Migrasi tidak pernah melintasi batas `converted` (`409 CONVERTED_STAGE_MIGRATION_REFUSED`): lead terkonversi hanya boleh dipindah ke tahap terkonversi lain. Database juga menegakkannya: lead berada di tahap terkonversi jika dan hanya jika ia punya konversi hidup, dan membawa `external_customer_ref` hanya selama konversi itu ada (constraint trigger tertunda, `sql/344`).
- **Intake** (`manual`, `import`, `api`): idempoten pada `Idempotency-Key` dan pada kunci sumber `(kind, channel account, externalEventId)`, diserialkan advisory lock. Sentuhan sumber pertama immutable; sentuhan berikutnya ditambahkan.
- **Transisi**: append-only, masing-masing menyebut revisi tempat ia terjadi; perpindahan diputuskan di bawah kunci baris pipeline lalu lead dengan `expectedVersion`, edge dan guard-nya diperiksa ulang di dalam transaksi.
- **Titik kontak**: ciphertext AES-256-GCM + keyed hash per tenant per jenis + bentuk tersamar, dengan DUA ring (ADR-0137 bagian 3): `CRM_LEADS_ENCRYPTION_KEYS` untuk ciphertext dan `CRM_LEADS_HASH_KEYS` untuk HMAC. Runtime menolak pasangan yang berbagi kunci, dan `config:validate` juga menolak kunci yang dipakai bersama ring atau secret kunci tunggal lain di deployment. Setiap respons tersamar; tidak ada endpoint yang mendekripsi. Pencarian adalah kecocokan hash persis di dalam satu tenant.
- **Kandidat dan merge**: kandidat adalah kecocokan hash persis di satu tenant, tidak pernah merge. Merge diverifikasi manusia (catatan, kedua versi), idempoten, diaudit, hanya dalam pipeline yang sama, dan dapat dibatalkan dalam jendela tenant (`mergeUndoHours`, default 168).
- **Konversi**: dicatat dari otoritas (`authority_confirmed`, referensi pelanggan opak, idempoten pada `evidenceRef`) atau jalur manual bertanda (`authority_unconfirmed`, permission terpisah, catatan wajib); dibalik lewat stempel pembalikan plus transisi baru, tidak pernah dengan mengedit riwayat.
- **Penghapusan**: `POST /leads/{id}/anonymize` menghapus nama, titik kontak, alasan, dan catatan; fakta tahap, sentuhan, transisi, dan konversi tetap ada sehingga hitungan funnel tidak berubah. Respons mutasi tidak pernah membawa nama tampilan atau bentuk kontak tersamar, sehingga replay idempotensi yang tersimpan tidak bisa melampaui penghapusan. Intake yang diulang hanya menjawab `{id, duplicate: true}`.
- **Event** (outbox, AsyncAPI): `awcms.crm_leads.lead.{created,stage_changed,assigned,merged,merge_reverted,converted,conversion_reversed,lost}`, hanya id opak dan referensi atribusi, `privacyClass: pseudonymous`.
- **Port**: `CrmLeadPort` (`_shared/ports/crm-lead-port.ts`, kapabilitas `crm_lead` 1.0.0) bagi otoritas hilir untuk membaca status lead serta mengonfirmasi atau membalik konversi.
- **Tabel** `sql/342`, permission `sql/343`, trigger integritas `sql/344`; RLS `FORCE` di semua tabel, foreign key tenant komposit, tanpa `DELETE` bagi `awcms_app`, tanpa grant sama sekali bagi `awcms_worker`.

## Pemetaan permission (nama kerja ADR-0153 → kunci yang di-seed)

| ADR-0153               | Di-seed                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `leads.read`           | `crm_leads.leads.read`                                            |
| `leads.create`         | `crm_leads.leads.create`                                          |
| `leads.update`         | `crm_leads.leads.update`                                          |
| `leads.assign`         | `crm_leads.leads.assign`                                          |
| `leads.delete` (soft)  | `crm_leads.leads.delete` (soft delete dan anonimisasi)            |
| (restore)              | `crm_leads.leads.restore`                                         |
| `leads.move`           | `crm_leads.stages.update`                                         |
| `leads.merge`          | `crm_leads.merges.manage`                                         |
| `pipeline.configure`   | `crm_leads.pipelines.configure` (juga sakelar tenant)             |
| `conversion.confirm`   | `crm_leads.conversions.approve`                                   |
| `conversion.manual`    | `crm_leads.manual_conversions.create`                             |
| `leads.export`         | tidak di-seed: ekspor ditunda (tidak ada route yang memeriksanya) |
| `milestones.configure` | tidak di-seed: milestone ditunda                                  |

## Ditunda (dicatat, tidak dibangun di irisan ini)

- Layar admin (modul `experimental` tanpa entri navigasi; permission ada di `NOT_YET_SCREENED`).
- Intake `website_form` lewat langganan `website_engagement.submission.received` dan aturan tenant `inbound_message` (O8); kedua jenis sumber ditolak lewat HTTP sampai konsumennya ada.
- Impor/ekspor CSV dengan netralisasi formula (T-X1) dan `leads.export`; milestone; ekstensi bertipe (O9 menyarankan tanpa ekstensi `pii` di v1); referensi consent dan `lead.consent_changed`; catatan; tautan `profile_id` opsional (O6).
- Proyeksi pelaporan dengan versi definisi dan bucket zona bisnis (T-R1); tabel transisi sudah membawa fakta dan indeks funnel yang diperlukan.
- Penyapuan retensi (O4): tabel menjawab `BOUNDED_BY_DESIGN` dengan tindak lanjut ini disebut, karena purge `generic` berbasis umur akan menghapus lead terkonversi dan tidak bisa menghormati anak-anak append-only.
- Job rekey titik kontak. Tidak dibangun di irisan ini karena tidak ringkas di sini: `awcms_worker` sengaja TIDAK punya grant pada tabel-tabel ini, sehingga job memerlukan migrasi grant worker per kolom ditambah deklarasi security-readiness, dan trigger `sql/344` melarang mengedit nilai kontak hidup, sehingga trigger perlu izin rekey; itu perubahan tersendiri yang ditinjau (pola `telegram:chat:rekey` / `channel-accounts:secrets:rekey`). Sampai ada, hanya TAMBAHKAN kunci ke salah satu ring.
- EKSPOR subjek data prospek (ADR-0153 T-P1): penghapusan sudah dibangun (`/anonymize`); ekspor data milik lead dengan sel yang dinetralkan dari formula belum, dan datang bersama pekerjaan ekspor CSV.
- `website_engagement` (ADR-0155) masih memakai satu ring untuk enkripsi dan HMAC; audit independen PR ini menemukan masalah ADR-0137 bagian 3 yang sama di sana. Tidak diubah di sini (modul lain); dicatat untuk perubahannya sendiri.
- Intake kredensial mesin (`api` oleh integrasi tanpa orang) dan akses terbatas pemilik atau scope (semua permission berlaku se-tenant hari ini; business scope pada pipeline adalah referensi opak, belum fakta ABAC).

## Untuk adapter: tanpa data pribadi di referensi

`externalCustomerRef`, `evidenceRef` dan `externalEventId` disimpan apa adanya, dibawa di event dan (referensi bukti) di baris audit. Nilainya wajib id OPAK (nomor pelanggan, id invoice, id event webhook), tidak pernah email, telepon, nama, atau nomor identitas. Pemeriksaan format (`A-Za-z0-9._:-`) tidak bisa membedakan id opak dari nomor telepon; ini kontrak bagi pemanggil.

## Keputusan terbuka (pilihan fail-closed yang diambil di sini)

- Mutasi menolak kredensial mesin (wajib orang yang akuntabel).
- Merge hanya diizinkan di dalam satu pipeline (lebih ketat dari "business scope yang sama").
- Lead terkonversi tidak dapat diserap merge; pembalikan tidak memerlukan edge yang diizinkan (itu koreksi), dan lead yang dianonimkan atau di-merge mempertahankan tahapnya saat pembalikan.
- Tidak ada endpoint dekripsi/reveal: staf hanya melihat titik kontak tersamar sampai maintainer mengadmisi satu dengan permission-nya sendiri.
