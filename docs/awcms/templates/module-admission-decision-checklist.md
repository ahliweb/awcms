# Module admission decision checklist

> **Status (2026-07-14):** Repo `awcms` baru pada tahap fondasi ulang (lihat
> [ADR-0001](../../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) —
> belum ada modul ERP yang diimplementasikan. Checklist ini adalah standar
> review yang berlaku begitu PR modul pertama diajukan, diadaptasi dari base
> [awcms-mini](https://github.com/ahliweb/awcms-mini).

Checklist siap-pakai untuk reviewer PR (manusia atau skill review otomatis)
yang menambah/mengubah modul baru, atau menambah provider eksternal baru ke
modul yang sudah ada. Setiap poin merujuk ke dokumen governance admission
modul (rencana: `docs/awcms/21_module_admission_governance.md`, dokumen
sumber kebenaran) — checklist ini merangkum, tidak menggantikan.

## A. Kategori & pohon keputusan

- [ ] Kategori (System/Official Optional Module/modul domain ERP/External
      Integration) sudah ditentukan lewat pohon keputusan, bukan
      diasumsikan.
- [ ] Bila proposal melibatkan runtime code upload/install/marketplace/eval
      dari input tenant/pihak ketiga apa pun: PR ini **ditolak** tanpa
      pengecualian kecuali sudah ada ADR baru yang mensupersede ADR fondasi
      yang berlaku.

## B. Dependency

- [ ] `ModuleDescriptor.dependencies` (lifecycle) hanya berisi modul yang
      benar-benar harus aktif lebih dulu — bukan orkestrasi call-time.
- [ ] Tidak ada cycle baru di dependency graph (test
      `validateModuleDependencyGraph`, atau padanannya, lolos).
- [ ] Setiap `capabilities.consumes` entry menandai `optional: true` atau
      tidak secara eksplisit, dan README modul mendokumentasikan perilaku
      degradasi saat kapabilitas itu tidak tersedia.

## C. Kompatibilitas offline/LAN vs full-online-only

- [ ] Kelas kompatibilitas (`offline-lan-safe`/`full-online-only`)
      dinyatakan eksplisit, bukan diasumsikan.
- [ ] Bila `full-online-only`: ada test/bukti bahwa profil `offline-lan`
      tetap 100% fungsional dengan fitur ini off (mis. transaksi
      finance/inventory tetap bisa dicatat lokal).
- [ ] Entri config registry baru (env var terkait) sudah diisi dengan
      profil deployment yang benar (semua profil vs online-only saja).

## D. Provider eksternal / data governance

Wajib dijawab bila PR menambah/mengubah adapter provider eksternal (payment
gateway, marketplace, tax/Coretax, logistik, dst.):

- [ ] Off-by-default: flag `*_ENABLED` default `false`, boot tidak gagal saat
      provider off.
- [ ] Kredensial hanya dari `process.env`/secret manager — tidak pernah dari
      kolom DB tenant-controlled, kecuali pengecualian yang sudah
      didokumentasikan sebagai accepted risk dengan rasional tertulis yang
      setara.
- [ ] Panggilan keluar terjadi **di luar** transaksi DB mana pun (pola
      claim/call/finalize).
- [ ] URL/host provider baru divalidasi terhadap SSRF (tidak resolve ke IP
      privat/loopback/link-local, tidak rentan DNS-rebinding) — jangan
      asumsikan aman hanya karena kredensialnya dari env.
- [ ] Ada circuit breaker + timeout per provider key.
- [ ] Kegagalan provider terdegradasi anggun — tidak memblokir alur
      operasional inti (mis. pencatatan transaksi tetap jalan, sinkronisasi
      ke provider tertunda), tidak merusak jaminan offline-first.
- [ ] Data yang dikirim ke provider sudah diminimalkan/dimask sesuai
      kebijakan data governance (NPWP/NIK/telepon/email/data finansial
      sensitif) — dokumentasikan PII/data sensitif apa yang keluar batas
      trust dan mengapa perlu.
- [ ] Retensi data di sisi provider didokumentasikan atau dinyatakan N/A.
- [ ] Error dari provider melewati fungsi redaksi log sebelum masuk log
      (tidak ada secret/PII/data finansial mentah di log).
- [ ] Perubahan konfigurasi provider (aktivasi/nonaktivasi, ganti kredensial)
      menulis audit log (aksi high-risk).
- [ ] Pertanyaan data-residency/subprocessor: di mana provider menyimpan
      data, apakah ToS/DPA-nya sudah ditinjau (governance, bukan kode) —
      dicatat sebagai catatan reviewer bila belum final.
- [ ] Bila modul menyentuh data finansial/pajak: ada jejak audit
      append-only untuk perubahan (bukan overwrite diam-diam), dan validasi
      kepatuhan (mis. format faktur pajak/Coretax) sudah direview pihak yang
      berwenang.
- [ ] Skill/proses security review yang berlaku sudah dijalankan dan
      hasilnya dilampirkan di PR.

## E. Ownership & lifecycle

- [ ] Modul baru men-set `type` di `module.ts` sesuai kategori yang
      disepakati (`system`/`domain`).
- [ ] Status lifecycle awal masuk akal (`experimental` untuk fitur baru yang
      belum matang, `active` bila sudah siap produksi) — bukan langsung
      `active` tanpa pertimbangan.
- [ ] Owner (CODEOWNERS atau `maintainers` bila sudah diisi) jelas.

## F. Deprecation/removal (bila PR ini men-deprecate/menghapus modul lain)

- [ ] Status descriptor diubah ke `deprecated` dengan changeset yang
      menjelaskan jalur migrasi dan target versi removal.
- [ ] Data posted/append-only milik modul yang di-deprecate/dihapus tidak
      pernah dihapus diam-diam — ada rencana arsip/retensi eksplisit (data
      finance/audit ERP sering punya kewajiban retensi hukum, cek dulu
      sebelum menentukan jendela deprecation).
- [ ] Ada jendela deprecation minimal (dicatat di changeset) sebelum kode +
      tabel benar-benar dihapus, dan tidak ada tenant/entitas yang masih
      `enabled` pada modul tersebut tanpa notice.
- [ ] Perubahan API/event terkait (route dihapus, event tidak dipublish
      lagi) sudah tercermin di OpenAPI/AsyncAPI dan changeset ber-bump
      `major` (breaking change, SemVer).

## G. Dokumentasi & kontrak

- [ ] OpenAPI diperbarui bila modul menambah endpoint.
- [ ] AsyncAPI diperbarui bila modul menambah/mengubah event.
- [ ] Migration baru ada bila skema berubah, dengan RLS + index FK, DAN ada
      test integrasi yang membuktikan isolasi tenant benar-benar gagal-aman
      (query lintas-tenant ditolak) — bukan hanya `FORCE ROW LEVEL SECURITY`
      yang dideklarasikan tanpa test yang menjalankannya.
- [ ] Changeset ditambahkan.
- [ ] README modul mendokumentasikan tujuan, tabel, endpoint, event,
      dependency, dan (bila relevan) provider eksternal + perilaku
      degradasinya.
