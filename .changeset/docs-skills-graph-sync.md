---
"awcms": patch
---

Sinkronkan dokumentasi, skill agen, dan knowledge graph dengan kode pasca-Gelombang 2.

`docs/ARCHITECTURE.md` sebelumnya masih menyebut delapan layar admin dan tidak
menyebut password reset, self-registration, maupun `/admin/security` sama sekali —
tiga permukaan auth yang sudah mendarat di #273/#276/#274.

`.claude/skills/awcms-auth-online-hardening/SKILL.md` memuat peringatan bahwa
seluruh epic hardening auth "FIKTIF, tidak ada kodenya". Audit yang menghasilkan
peringatan itu (2026-07-18) benar untuk saat itu, tetapi MFA (#184), OIDC/SSO
(#185), Turnstile (#186), dan admin policy UI (#274) sudah dibangun sejak itu —
agen yang mempercayai peringatannya akan membangun ulang semuanya. Peringatan
diganti dengan §Peta ke artefak nyata awcms yang memetakan nama/path/nomor
migrasi milik awcms-micro ke padanan awcms, dan menandai satu-satunya item yang
memang sengaja tidak ada (login Google-spesifik).

`.claude/skills/README.md` menyatakan `work-class` "benar-benar tidak ada",
padahal `db:work-class:generate`/`:check` sudah ada dan ikut di rantai
`bun run check`. Hitungan script juga dikoreksi 63 → 67.

`graphify-out/` di-update inkremental (231 berkas berubah; 8159 node, 21470 edge).
`.graphify_analysis.json` dikeluarkan dari tracking: langkah terakhir pipeline
graphify menghapusnya, jadi salinan yang ter-commit hanya bisa basi.
