---
"awcms": patch
---

Menonaktifkan tenant user kini benar-benar mengakhiri aksesnya — seketika,
bukan "paling lama satu masa berlaku sesi".

`setTenantUserStatus` menulis `status = 'inactive'` dan komentar dokumennya
sendiri menyatakan itu "revokes all of a user's access". Rantai guard tidak
pernah membaca kolom itu: `resolveTenantContext` mencari sesi dan BARIS tenant
user, bukan statusnya. Jadi pengguna yang baru dinonaktifkan tetap bekerja
normal sampai sesinya kebetulan kedaluwarsa — dan satu-satunya cara
menyadarinya adalah mencoba.

Deaktivasi kini mencabut setiap sesi hidup identitas itu, **di dalam transaksi
yang sama** dengan penulisan status: deaktivasi yang ter-commit sementara
pencabutannya gagal akan meninggalkan sesi hidup persis untuk akun yang baru
saja diputuskan untuk ditutup.

Kredensial mesin tidak butuh sapuan terpisah — jalur prinsipal mesin (ADR-0049)
mensyaratkan tenant user AKTIF, jadi keduanya berhenti pada instan yang sama.
Test membuktikan keduanya bekerja terpisah: menghapus pencabutan sesi
memerahkan 3 test, sementara test kredensial mesin tetap hijau.

Diverifikasi terhadap PostgreSQL nyata (6 test), termasuk dua yang menjaga arah
sebaliknya: sesi pengguna lain tidak tersentuh, dan reaktivasi **tidak**
menghidupkan kembali sesi yang sudah dicabut — urutan deactivate/reactivate
justru yang dipakai operator saat mencurigai sebuah sesi.
