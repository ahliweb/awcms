---
"awcms": patch
---

Perbaiki logika fallback media type di `scripts/api-spec-check.ts` (CodeQL alert #140, `js/trivial-conditional`). `asRecord()` selalu mengembalikan objek non-null, sehingga operator `??` pada `asRecord(content["application/json"]) ?? Object.values(content)[0]` membuat cabang fallback jadi dead code — response error yang hanya memakai media type non-`application/json` salah dilaporkan tidak beresolusi ke envelope `ApiError`. Nullish-coalescing dipindahkan ke dalam `asRecord` agar fallback ke media type pertama benar-benar berjalan.
