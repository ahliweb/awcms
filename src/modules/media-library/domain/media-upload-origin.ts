/**
 * The origin a BROWSER uploads bytes to, derived from deployment config so a
 * Content-Security-Policy never has to hold a second copy of it.
 *
 * ## Why this is a different origin from the public one
 *
 * `deriveMediaPublicOrigin` answers "where are media objects READ from" —
 * `NEWS_MEDIA_R2_PUBLIC_BASE_URL`, typically an R2 custom domain. This answers
 * a different question: "where does the presigned `PUT` go", which is R2's
 * S3-compatible API endpoint, `https://{accountId}.r2.cloudflarestorage.com`
 * (`media-r2-client.ts` builds exactly that, with a test-only override).
 *
 * They are not interchangeable and are usually not even the same host. A
 * deployment can serve reads from `media.example.com` while every upload still
 * goes to the account endpoint.
 *
 * ## Why a CSP needs it at all, and why its absence was invisible
 *
 * The direct-to-R2 upload flow is `POST` a session here, then `PUT` the bytes
 * from the browser straight to the presigned URL. That `PUT` is a
 * `fetch`/`XMLHttpRequest` to a THIRD-PARTY origin, and `connect-src` governs
 * it. Until this existed there was no `connect-src` directive at all, so it
 * fell through to `default-src 'self'` and the browser refused the upload
 * before a byte left the machine.
 *
 * This is the THIRD instance of one defect: `img-src` was missed and every R2
 * image rendered as an empty box; `media-src` was missed the same way and every
 * gallery video stayed blocked while the images beside it loaded. The shape
 * repeats because a directive that is never named does not announce its
 * fall-through — the failure appears in a console, not in a response.
 *
 * ## Unconfigured is a STATE, not an error
 *
 * On LAN/offline deployments R2 is switched off entirely and no upload origin
 * exists. That reports `configured: false` so the caller adds no third-party
 * source rather than a broken one — the same contract, and for the same
 * reason, as `deriveMediaPublicOrigin`.
 */

export type MediaUploadOrigin = {
  /** `false` when the deployment accepts no direct-to-R2 upload at all. */
  configured: boolean;
  /** Scheme + host + port, e.g. `https://abc123.r2.cloudflarestorage.com`. */
  origin: string | null;
};

const UNCONFIGURED: MediaUploadOrigin = { configured: false, origin: null };

/**
 * Derives the browser-visible upload origin.
 *
 * `endpointOverride` mirrors `media-r2-client.ts`'s own test-only override (a
 * local fake S3-compatible server): when it is set it IS the endpoint, so the
 * policy must name it or the fake is blocked exactly as the real one would be.
 *
 * A value that is set but unparseable reports UNCONFIGURED rather than being
 * echoed back, for the reason `deriveMediaPublicOrigin` states: handing a
 * consumer a malformed origin to put in a CSP is worse than telling it there is
 * none, because the whole policy can be rejected and take every other directive
 * with it.
 */
export function deriveMediaUploadOrigin(
  accountId: string,
  endpointOverride?: string
): MediaUploadOrigin {
  const override = (endpointOverride ?? "").trim();

  if (override !== "") {
    return parseOrigin(override);
  }

  const account = accountId.trim();

  if (account === "") return UNCONFIGURED;

  // The account id lands in a host name. Anything outside the character set R2
  // actually issues would either be a different host or an invalid one, and a
  // CSP source is the wrong place to discover that.
  if (!/^[A-Za-z0-9-]+$/.test(account)) return UNCONFIGURED;

  return parseOrigin(`https://${account}.r2.cloudflarestorage.com`);
}

function parseOrigin(candidate: string): MediaUploadOrigin {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return UNCONFIGURED;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return UNCONFIGURED;
  }

  return { configured: true, origin: parsed.origin };
}
