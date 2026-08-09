---
"awcms": minor
---

feat(auth): dua layar platform-scoped berhenti menyalin aturan ADR-0053 (#450, R3)

`tenants` dan `idn-regions` berpindah ke `loadAdminScreen`. Ledger 14 → 12.

Keduanya bukan migrasi mekanis: masing-masing menyimpan **salinan kedua** aturan
platform-scope ADR-0053, ditulis tangan di frontmatter sebagai
`holds… && isPlatformTenant`, bebas menyimpang dari satu-satunya salinan yang
mengikat di `access-guard.ts`.

`authorizeInTransaction` memutuskan `platform_scope_required` **sebelum**
permission dicari sama sekali. Itu lebih keras daripada yang disalin: baris grant
yang sampai ke tenant yang salah — restore backup, INSERT tangan, jalur
provisioning baru yang lupa `WHERE scope = 'tenant'` — menjadi inert, bukan
mencukupi. Jadi salinan tangannya dihapus, tidak diporting.

Asimetri keduanya berbeda dan itu yang membuat masing-masing menarik:

- **`tenants`** — `tenant_provisioning.read` sendiri PLATFORM-scoped, jadi
  keputusan masuknya sepenuhnya milik chokepoint.
- **`idn-regions`** — `dataset.read` TENANT-scoped sementara `configure` dan
  `restore` PLATFORM-scoped. `can(...)` menjalankan gerbang ADR-0053 yang sama
  dengan endpoint-nya, jadi dua tombol tulisnya kini digerbangi kode yang sama,
  bukan tiruannya.

`resolvePlatformTenant` tetap dipanggil di kedua layar, kini **untuk TAMPILAN
saja**: supaya layar bisa mengatakan MENGAPA sebuah kontrol tidak ada, bukan
meninggalkan ruang kosong. Ia tetap di luar transaksi tenant — keduanya membaca
tabel root bebas-RLS dan tidak butuh konteks tenant.

## Satu kalimat yang berhenti mengklaim apa yang tak lagi diketahui

Pemberitahuan scope di `/admin/tenants` berbunyi "Your role carries the
permission; the action is refused because of where it is being made". Sesudah
migrasi kalimat itu **tidak bisa lagi dibuktikan**: gerbang platform menolak
sebelum permission dicari, jadi halaman ini tidak tahu apakah pembacanya
benar-benar memegangnya. Diganti menjadi klaim yang tetap benar — penolakannya
soal DI MANA aksi dilakukan, dan tidak ada grant di tenant ini yang bisa
membukanya.

Dua state penolakan kini dipisah jujur: bukan tenant platform → catatan scope;
tenant platform tetapi ditolak → catatan permission.

## Tiga test diperbaiki, dan alasannya sama dengan yang dihapus

`tenant-provisioning` dan `admin-idn-regions-page-contract` mematok persis
ekspresi `holds… && isPlatformTenant` yang menjadi cacatnya. Mempertahankannya
akan menjadikan test itu alasan untuk MENYIMPAN duplikat aturan.

Keduanya kini membuktikan sifat yang sama dari dua hal yang benar-benar
menegakkannya: `scope` di deskriptor modul (data hidup — kalau
`tenant_provisioning.read` pernah berubah menjadi `tenant`, layarnya diam-diam
terbuka untuk setiap owner tenant, dan asersi atas teks halaman tidak akan
menyadarinya) dan perutean lewat `loadAdminScreen`. Ekstraktor klaim
`admin-idn-regions` juga digabungkan dengan bentuk objek-literal, sekelas dengan
batch 1 dan 4.
