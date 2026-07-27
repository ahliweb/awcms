---
"awcms": patch
---

Naikkan `astro` 7.1.1 → 7.1.3.

Ikut memperbarui `stack.astro.declared` di `awcms-family-compatibility.yaml`.
Manifest itu menyematkan versi stack ke `package.json` sebagai sumber
kebenaran, jadi setiap bump Astro memerahkan `family:conformance:check`
(`[FAIL] stack: Astro (declared ^7.1.1 vs actual ^7.1.3)`) sampai deklarasinya
diperbarui di perubahan yang sama — persis perilaku yang diinginkan ADR-0032:
pinning-nya bukan free-floating, jadi bump toolchain tak bisa lewat tanpa
terlihat.
