# Definition of Ready (langkah 9 alur pengembangan)

> **Dijawab SEBELUM ada yang menulis kode**, dan itulah seluruh gunanya.
> [`../../../CONTRIBUTING.md`](../../../CONTRIBUTING.md) memuat Definition of **Done**,
> yang diperiksa di ujung. Daftar ini diperiksa di pangkal.

- **Langkah alur:** 9 ([`../alur-pengembangan.md`](../alur-pengembangan.md)).
- **Untuk modul BARU**, daftar ini tidak menggantikan
  [`module-admission-decision-checklist.md`](module-admission-decision-checklist.md)
  — ia mendahuluinya.

## Kenapa daftar ini ada, dengan bukti dari repo ini sendiri

**Dua gelombang berturut-turut menulis rencana yang mengasumsikan pembacaan
lintas-tenant yang FORCE RLS larang.** ADR-0087 memintanya sebagai "baris audit
di setiap tenant terjangkau"; ADR-0088 memintanya sebagai daftar keanggotaan di
respons 409. Keduanya masuk akal di atas kertas, keduanya lolos perencanaan, dan
keduanya baru ketahuan **saat implementasi** — setelah kode ditulis di atas
premis yang salah.

Satu pertanyaan akan menemukan keduanya di langkah 9, dan ia yang pertama di
bawah.

## Pertanyaan yang berlaku untuk SETIAP perubahan

1. **Apakah policy mengizinkan setiap pembacaan dan penulisan yang rencana ini
   butuhkan?** Bukan "apakah ada permission-nya" — apakah **RLS** mengizinkannya.
   Sebuah rencana yang membaca lintas tenant, atau menulis ke tenant lain,
   hampir selalu salah, dan yang tidak salah menuntut ADR.
   **Cara memverifikasi**: jalankan query-nya sebagai `awcms_app` di konteks
   tenant yang relevan terhadap basis data berisi data yang mirip. Nol baris
   adalah jawaban, bukan kegagalan setup.
2. **Kelas perubahannya apa?** (tabel di dokumen alur). Ia yang menentukan
   langkah 1–8 mana yang wajib, dan menebaknya di tengah jalan adalah bagaimana
   sebuah PR menjadi dua PR.
3. **Apa kriteria diterimanya, dalam kalimat yang bisa gagal?** "Bekerja dengan
   baik" tidak bisa gagal. "Pencabutan grant mematikan sesi hidup di transaksi
   yang sama" bisa.
4. **Apa yang akan MEMBUKTIKANNYA, dan mutasi apa yang memerahkannya?** Sebuah
   cek yang hijau tidak membuktikan apa pun sampai ia dibuktikan gagal pada
   kondisi yang seharusnya. Bila jawabannya belum terpikir di langkah 9, biasanya
   berarti kriteria di nomor 3 belum cukup tajam.

## Pertanyaan bersyarat

| Bila perubahan menyentuh…       | Yang harus sudah dijawab                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| skema                           | tabel/kolomnya, RLS-nya, index FK-nya, **dan jawaban retensinya** (gerbangnya akan menuntut) |
| akses (RBAC/ABAC/RLS)           | permission mana, deny-only atau tidak, dan di mana urutannya dalam rantai chokepoint         |
| kontrak API/event               | fragmen OpenAPI/AsyncAPI-nya, dan apakah perubahannya aditif                                 |
| data pribadi                    | tiga pertanyaan di [`../privacy-analysis.md`](../privacy-analysis.md) §3                     |
| sesuatu yang mendarat **inert** | apa yang membuatnya inert, dan PR mana yang menghidupkannya                                  |
| lapisan fondasi                 | **ADR-nya**, bukan niat menulis ADR                                                          |

## Dua hal yang BUKAN bagian dari daftar ini

- **Estimasi.** Tidak ada di alur ini dan tidak ditambahkan di sini.
- **Desain lengkap.** Langkah 9 menanyakan apakah rencananya bisa dikerjakan dan
  apakah spesifikasinya saling setuju — bukan menuntut jawaban akhir untuk
  pertanyaan yang justru paling murah dijawab dengan menulis kode.
