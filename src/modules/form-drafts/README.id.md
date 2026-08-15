🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:1acfbe3b3a73efdd954f34d773827fcfd26c8c4e23d458633cda57fbae608259 -->

# form_drafts

**Penyimpan draft sisi-server** yang generik dan tak terikat domain untuk formulir
multi-langkah. Di-port dari awcms-micro (Issue #484) sebagai baris 1 Gelombang 1 di
[`docs/awcms/absorb-awcms-micro-roadmap.md`](../../../docs/awcms/absorb-awcms-micro-roadmap.md).

## Apa ini, dan apa yang SENGAJA bukan

Satu tabel (`awcms_form_drafts`, `sql/062`) yang menyimpan **payload JSONB opak**
plus koordinat yang dibutuhkan untuk melanjutkannya: `module_key`, `wizard_key`,
`resource_type`, `resource_id`, `current_step`.

Apa **MAKNA** sebuah payload dimiliki oleh modul mana pun yang membuatnya. Modul ini
tidak pernah memeriksanya di luar aturan keselamatan di bawah. Itulah seluruh
maksudnya — itulah yang membuat satu tabel bisa melayani setiap formulir
multi-langkah tanpa modul ini menimbun pengetahuan domain yang lalu harus ia jaga
tetap seiring dengan modul lain.

Ia bertipe `type: "system"` dengan alasan yang sama seperti `logging` dan
`data_lifecycle`: mekanisme platform bersama, bukan fitur yang menghadap tenant.

## Aturan keselamatan pada payload

Dua aturan, keduanya ditegakkan di `domain/form-draft-validation.ts` (murni, tanpa
I/O):

1. **Plafon ukuran** — 32 KB terserialisasi. Longgar untuk nilai coret-coret satu
   formulir sekaligus membatasi pembengkakan baris pada kasus terburuk. Ini adalah
   state draft, bukan penyimpan dokumen.
2. **Kunci berbentuk-rahasia DITOLAK, bukan diredaksi.** Kunci apa pun pada
   kedalaman bersarang mana pun (termasuk di dalam array) yang cocok dengan
   `password`, `token`, `secret`, `credential`, `api[_-]?key`, atau
   `private[_-]?key` menggagalkan SELURUH penulisan dengan 400 yang menyebutkan
   path pelanggarnya.

Menolak alih-alih diam-diam membuang adalah pilihan yang disengaja: pemanggil yang
menerima 200 tidak punya cara membedakan field yang dibuang dari field yang
tersimpan, dan akan dengan senang hati terus percaya rahasianya bolak-balik utuh.

## Endpoint

Semuanya ber-scope tenant, dilindungi RLS, digerbangi ABAC (`form_drafts.draft.*`,
di-seed oleh `sql/063`):

| Metode   | Jalur                             | Penjaga        | Catatan                                   |
| -------- | --------------------------------- | -------------- | ----------------------------------------- |
| `GET`    | `/api/v1/form-drafts`             | `draft.read`   | Dibatasi 100, terbaru dulu, tanpa cursor  |
| `POST`   | `/api/v1/form-drafts`             | `draft.create` | Tanpa `Idempotency-Key` — lihat di bawah  |
| `GET`    | `/api/v1/form-drafts/{id}`        | `draft.read`   |                                           |
| `PATCH`  | `/api/v1/form-drafts/{id}`        | `draft.update` | Hanya selama status `draft`               |
| `DELETE` | `/api/v1/form-drafts/{id}`        | `draft.delete` | Hapus lunak; idempoten secara konstruksi  |
| `POST`   | `/api/v1/form-drafts/{id}/submit` | `draft.update` | **Mewajibkan `Idempotency-Key`**, diaudit |

**Mengapa `create` tak butuh kunci idempotensi tetapi `submit` butuh.** Create yang
diulang hanya berbiaya satu baris coret-coret bernilai rendah yang bisa dihapus
pemanggilnya. Submit yang diulang menyerahkan payload ke sebuah aksi domain untuk
KEDUA kalinya. Asimetri itulah intinya — mewajibkan kunci di mana-mana melatih
pemanggil membuat kunci sekali-buang, yang justru melemahkan jaminannya tepat di
tempat yang penting.

Tidak ada permission `submit` terpisah. Submit adalah transisi pada draft yang boleh
Anda sunting, jadi ia digerbangi `draft.update`. Menambahkan aksi `submit` juga akan
berarti melebarkan union `AccessAction` — dan aksi yang tak seorang pun seed ke
dalam sebuah role akan men-deny bahkan pemilik tenant, sambil tampak sepenuhnya
benar saat ditinjau.

## Retensi: kedaluwarsakan, lalu purge

`bun run form-drafts:purge` (harian) menjalankan dua fase berbeda yang sengaja
dapat dipisahkan:

1. `expireOverdueFormDrafts` — sebuah `draft` yang melewati `expires_at` pemberian
   pemanggil menjadi `status = 'expired'`. Sebuah **transisi, bukan penghapusan**:
   barisnya masih ada untuk audit dan debugging, hanya saja tak lagi bisa
   dilanjutkan.
2. `purgeExpiredFormDrafts` — menghapus secara fisik baris `expired`/`abandoned`
   yang lebih tua dari `FORM_DRAFT_DEFAULT_RETENTION_DAYS` (30), berdasarkan
   `updated_at`.

Keduanya berbatas (5000/batch) dan mengaudit dirinya sendiri.

### Penegakan legal hold ada DI SINI, bukan di `data_lifecycle`

Modul ini mendaftarkan descriptor `dataLifecycle` bertipe `delegated`
(`form_drafts.form_drafts`). Perencana dry-run engine `data_lifecycle` boleh
**MEMBACA** tabel ini demi visibilitas backlog, tetapi ia tidak pernah memutasinya —
jadi legal hold yang hanya ditegakkan di dalam engine itu tidak akan menghentikan
apa pun.

Titik penegakan yang sesungguhnya adalah `purgeExpiredFormDrafts`, yang bertanya
kepada `LegalHoldGuardPort` yang diinjeksikan
(`_shared/ports/legal-hold-guard-port.ts`) sebelum `DELETE`-nya dan melewati
SELURUH batch ketika descriptor-nya sedang ditahan. Fase 1 **TIDAK** digerbangi: ia
tak pernah menghapus apa pun, jadi ia tidak membawa kehilangan tak-terpulihkan yang
menjadi alasan keberadaan legal hold.

`module.ts` mengekspor `FORM_DRAFTS_LIFECYCLE_KEY` dan purge mengimpornya, sehingga
kunci yang dipakai memasang hold dan kunci yang diperiksa purge tidak bisa
menyimpang. Kalau menyimpang, hold itu akan fail open secara senyap dan datanya
tetap lenyap.

Port ini adalah **seam tingkat-sumber**, bukan entri capability-registry, dan
diinjeksikan di composition root (`scripts/form-draft-purge.ts`) — mengimpor
internal `data_lifecycle` langsung dari sini akan menjadi impor lintas-modul yang
sirkular.

## Tidak termasuk dalam port ini

Pustaka **komponen** wizard milik awcms-micro (`WizardStepper`, `WizardPanel`,
`WizardActions`, `wizard-client.ts`) adalah baris Gelombang-0 tersendiri yang masih
terbuka (`src/components/ui/`). Penyimpan ini bisa dipakai tanpanya — sebuah wizard
berbicara ke API ini, bukan sebaliknya.
