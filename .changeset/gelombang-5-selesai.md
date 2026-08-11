---
"awcms": patch
---

docs(state): Gelombang 5 selesai — catat koreksi bentuk PR 5.4 yang KEDUA, dan apa yang tersisa

§4 sebelumnya menuliskan bentuk PR 5.4 yang benar setelah koreksi pertama.
Koreksi itu lalu ikut salah, dan `modules:table-writes:check` yang menemukannya:
menulis langganan saat tenant lahir membuat `awcms_tenant_subscriptions` ditulis
dua modul (ADR-0013 §6). Jawabannya menurunkan default-nya alih-alih
menuliskannya. Dokumen yang membiarkan resep lamanya berdiri adalah dokumen yang
percaya diri dan salah — persis kelas yang berkali-kali menggigit repo ini.

ADR-0084 ikut dikoreksi: ia menjanjikan `/admin/subscriptions` mendarat di PR
5.4, padahal layar itu dipisah dan belum dibangun.
