---
"awcms": patch
---

fix(admin): `/admin/media` shows the uploader only to a caller holding `media_library.media.create`, `.verify` and `.cancel` together. The browser flow calls three endpoints behind those three separate keys, so a custom role holding `create` alone used to start an upload that returned 403 at finalize and again at cancel, leaving a `pending_upload` row each time. A caller holding some but not all now sees a notice naming the missing keys (en/id); a caller holding none sees what they saw before. No endpoint, permission or migration change: the endpoints still decide. New `tests/media-upload-permission-seed.test.ts` pins that no migration grants `create` without the other two and that the owner's blanket grant cannot exclude one of the three alone; the page-contract test and the screen-coverage ledger now treat `verify` and `cancel` as screened.
