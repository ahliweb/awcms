---
"awcms": patch
---

fix(media-library): the over-cap refusal on `/admin/media` no longer says "This GIF is 2 MiB, over the 2 MiB limit" for a file only just over the cap (Issue #1238). When the size and the cap round to the same label, both are now shown in the next finer unit (`2,049 KiB` against `2,048 KiB`, `2.049 KiB` in Indonesian), and in bytes for a file under 1 KiB over. Files far from the cap read as before. The message texts are unchanged, so the EN and ID catalogues are untouched.

The client asset budget is raised by 320 B (362,560 -> 362,880) with a ledger entry in `scripts/client-asset-budget.ts`; the code exists once, in `src/lib/ui/media-image-compression-plan.ts`.
