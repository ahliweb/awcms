---
"awcms": minor
---

Beri `--dry-run` pada dua job retensi destruktif yang selama ini tak punya, dan
hentikan headernya mengklaim kemiripan yang tidak ada.

`form-drafts:purge` **menghapus baris secara fisik**; `comments:retention`
meng-NULL-kan kolom identitas penulis **secara tak terbalikkan** lalu menghapus
langganan yang tak pernah dikonfirmasi. Keduanya menyatakan di headernya sendiri
bahwa mereka meniru `scripts/audit-log-purge.ts` — yang sudah punya pratinjau
sejak dikirim. Keduanya tidak. Jadi satu-satunya cara mengetahui radius ledakan
run pertama adalah menjalankannya.

Dua hal yang membuat pratinjau ini bukan sekadar penghitung:

- **Satu fungsi cutoff, dipakai bersama.** `resolveFormDraftRetentionCutoff` dan
  `resolveCommentsRetentionCutoff` diekstrak, lalu jalur nyatanya ikut memakai —
  dua salinan `now - days * 86400000` akan menyimpang begitu salah satunya
  diedit, dan pratinjau yang tak sepakat dengan run yang dipratinjaunya lebih
  buruk daripada tak ada.
- **Legal hold ditanya, dan dilaporkan.** Deskriptor yang di-hold membuat run
  nyata tak menyentuh apa pun; pratinjau yang mengabaikannya akan melaporkan
  backlog yang tak akan pernah disentuh run mana pun — justru angka yang paling
  mungkin ditindaklanjuti operator. `comments:retention` melaporkan
  `heldTenants` supaya "tak ada yang perlu dikerjakan" bisa dibedakan dari
  "sedang di-hold".

Header keduanya juga dikoreksi: alih-alih mengklaim meniru job yang memakai
`runJob`, keduanya kini menyatakan apa yang memang TIDAK mereka punya (advisory
lock, telemetry `JobResult`, cancellation kooperatif) dan bahwa karenanya
keduanya harus dijadwalkan dari SATU entri cron. Migrasi ke `runJob` tetap
dilacak di isu #291.
