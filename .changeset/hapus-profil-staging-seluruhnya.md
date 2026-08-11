---
"awcms": minor
---

Profil deployment `staging` dihapus SELURUHNYA (ADR-0083, sebagaimana diamandemen)

Bukan hanya environment staging milik repo ini yang dibongkar, melainkan
`staging` sebagai profil deployment: ia keluar dari `ModuleDeploymentProfile`
(`src/modules/_shared/module-contract.ts`), dari nilai `APP_ENV` yang diterima,
dari `.env.example`, dan dari seluruh dokumentasi. Profil yang tersisa:
`development` / `production` / `offline-lan`.

**Ini membalik ADR-0083 edisi pertama.** ADR itu, ditulis hari yang sama,
MEMPERTAHANKAN `staging` dan mendaftarkan penghapusannya sebagai DITOLAK dengan
alasan "mencabut kapabilitas dari setiap pemakai template". Pemilik repo
membatalkan argumen itu, dan karena ADR-0083 belum ter-commit dan belum dirilis
ia **diamandemen di tempat** alih-alih di-supersede ADR baru — sebuah ADR yang
berbunyi "`staging` tetap sah" di sebelah kode yang tak memuatnya adalah persis
dokumen percaya-diri-dan-salah yang berulang kali menggigit repo ini.

Alasan yang menggantikannya: **profil deployment yang tak pernah dijalankan
siapa pun adalah klaim, bukan kapabilitas.** `staging` tidak pernah punya satu
pun jalur kode yang memperlakukannya berbeda dari `production`; satu-satunya
`APP_ENV=staging` yang benar-benar berjalan justru sedang melayani domain
produksi di atas database staging. Pemakai template yang butuh environment kedua
membuatnya dengan `APP_ENV=production` kedua dan basis data kedua.

**Dampak bagi instalasi turunan (BREAKING pada level authoring, bukan runtime):**
`module.ts` yang mendeklarasikan `deploymentProfiles: ["staging"]` kini gagal
typecheck. Ganti ke profil yang tersisa, atau hilangkan field-nya (absennya
berarti "tanpa batasan profil"). Komposisi build-time membandingkan string biasa,
jadi tidak ada perilaku runtime yang berubah. Deployment yang menjalankan
`APP_ENV=staging` harus pindah ke `APP_ENV=production` sebelum upgrade —
`config:validate` menolak nilai lama.

Sisi infrastruktur (di luar repo): produksi ditegakkan di `awcms.ahlikoding.com`;
app Coolify, database, dan Varnish staging dibongkar setelah backup diambil DAN
diverifikasi lewat restore-drill ke database scratch.
