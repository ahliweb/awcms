---
"awcms": minor
---

feat(media-library): the default per-image upload cap is now 2 MiB (was 10 MiB), and the admin media screen compresses oversize JPEG, PNG and WebP images in the browser before upload so ordinary phone photos are accepted instead of refused (#1221).

**Behaviour change for deployments that do not set `NEWS_MEDIA_R2_MAX_UPLOAD_BYTES`:** the server now refuses an image over 2 MiB (`2097152` bytes) at upload-session creation and at finalize. Set the variable (for example `10485760`) to keep the old limit; a deployment that already sets it is unaffected, and the env override and its fallback for malformed values are unchanged. Other API clients that upload directly must now stay within the cap themselves.

On `/admin/media`: a file within the cap is uploaded unchanged; a JPEG, PNG or WebP over the cap is re-encoded in the browser (WebP, or JPEG for an opaque JPEG when smaller; transparency is kept; EXIF orientation is applied; long edge 2560 down to a 1280 px floor, quality 0.85 down to 0.5; never upscaled) and the upload session claims the size and type of the compressed bytes. A GIF is never re-encoded, so a GIF over the cap is refused; an image that is still over the cap at the floor, or a browser without `createImageBitmap`/canvas encoding, is refused with a message that names the cap. Re-encoding drops EXIF and GPS metadata; files uploaded unchanged keep theirs. The compressing state is announced through an `aria-live` region, with the original and final size shown, in English and Indonesian.

No schema change, no new dependency, and no change to the presigned-upload flow or to what the server checks.
