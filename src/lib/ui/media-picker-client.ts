/**
 * A reusable media picker (Issue #595).
 *
 * ONE picker, called from the article editor and — when ad inventory lands
 * (#594) — from there too. The issue is explicit about that: "satu pemilih,
 * bukan dua". Two pickers would drift, and the one that drifted would be the
 * one nobody was looking at.
 *
 * ## Authority stays with the endpoint, not with this screen
 *
 * The picker fetches `GET /api/v1/media/objects/list`, which enforces
 * `media_library.media.read` itself. That is deliberate: `/admin/blog` holds
 * `blog_content.posts.*` and nothing else, and
 * `tests/admin-blog-page-contract.test.ts` pins it to exactly that set so
 * borrowing another module's permission is a decision somebody edits a file
 * for. Reading the catalogue from the BROWSER, against a guarded endpoint,
 * needs no new server-side gate here — and a caller who lacks `media.read`
 * gets a 403 the picker reports plainly rather than an empty list that looks
 * like an empty library.
 *
 * ## Only publicly-referenceable objects are offered
 *
 * `/admin/media` deliberately renders no `<img>`: a row there can be
 * `pending_upload` or `failed`, the bytes may be absent or unverified, and the
 * screen exists partly so somebody can DELETE a policy-violating image —
 * showing it one more time to the person removing it is the wrong outcome.
 *
 * That argument does not carry over here, and the difference is the status
 * filter. This picker requests `status=verified` — bytes that passed the full
 * finalize pipeline (magic-byte MIME sniff over the real content, checksum,
 * authoritative size) — which is the same set `isPubliclyReferenceable`
 * admits. An author is choosing something to publish; offering a row whose
 * bytes may not exist would let them attach a broken image to a story and find
 * out from a reader.
 */

export type PickableMediaObject = {
  id: string;
  publicUrl: string;
  originalFilename: string | null;
  mimeType: string;
  altText: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
};

export type MediaPickerResult =
  | { ok: true; items: PickableMediaObject[] }
  | { ok: false; reason: "forbidden" | "unavailable" };

/** The one query this picker issues. Exported so a test can pin it. */
export const PICKER_LIST_URL =
  "/api/v1/media/objects/list?status=verified&deletion=live";

/**
 * Fetches the choosable objects.
 *
 * `deletion=live` as well as `status=verified`: a soft-deleted object can still
 * be `verified`, and every reference to it stops resolving the moment it is
 * deleted. Offering one would hand the author an image that is already gone.
 */
export async function fetchPickableMedia(
  fetchImpl: typeof fetch = fetch
): Promise<MediaPickerResult> {
  let response: Response;

  try {
    response = await fetchImpl(PICKER_LIST_URL, {
      credentials: "same-origin"
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (response.status === 403) return { ok: false, reason: "forbidden" };
  if (!response.ok) return { ok: false, reason: "unavailable" };

  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: { items?: unknown };
  } | null;

  if (payload?.success !== true || !Array.isArray(payload.data?.items)) {
    return { ok: false, reason: "unavailable" };
  }

  return {
    ok: true,
    items: payload.data.items.map(toPickable).filter(isUsable)
  };
}

function toPickable(raw: unknown): PickableMediaObject {
  const record = (raw ?? {}) as Record<string, unknown>;

  return {
    id: typeof record.id === "string" ? record.id : "",
    publicUrl: typeof record.publicUrl === "string" ? record.publicUrl : "",
    originalFilename:
      typeof record.originalFilename === "string"
        ? record.originalFilename
        : null,
    mimeType: typeof record.mimeType === "string" ? record.mimeType : "",
    altText: typeof record.altText === "string" ? record.altText : null,
    caption: typeof record.caption === "string" ? record.caption : null,
    width: typeof record.width === "number" ? record.width : null,
    height: typeof record.height === "number" ? record.height : null
  };
}

/**
 * Drops anything that could not be attached or displayed.
 *
 * An entry with no id cannot be submitted, and one with no `publicUrl` would
 * render as a broken thumbnail the author might still click. Both mean the
 * response disagreed with its own contract, and silently skipping is better
 * than offering a choice that fails later.
 */
function isUsable(item: PickableMediaObject): boolean {
  return item.id !== "" && item.publicUrl !== "";
}

/**
 * What to show for an object in a list of choices.
 *
 * Alt text first: it is what a person wrote ABOUT the picture, so it identifies
 * it far better than `DSC_0431.jpg`. The filename is the fallback, and a
 * last-resort label exists because both can be absent and a blank button is
 * unclickable in practice.
 */
export function describePickableMedia(item: PickableMediaObject): string {
  const described = (item.altText ?? "").trim() || (item.caption ?? "").trim();

  if (described !== "") return described;

  const filename = (item.originalFilename ?? "").trim();

  return filename !== "" ? filename : "Untitled image";
}
