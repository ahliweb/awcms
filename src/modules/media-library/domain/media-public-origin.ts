/**
 * The origin media `publicUrl`s are served from, derived from deployment
 * config so a client never has to hold a second copy of it.
 *
 * ## Why this exists
 *
 * `media_object_directory` builds every `public_url` from
 * `NEWS_MEDIA_R2_PUBLIC_BASE_URL` — a server-side environment variable. A build
 * client (`awcms-astro`) needs that host BEFORE it fetches a single object,
 * because its Content-Security-Policy has to name the origin in `img-src` at
 * build time; `img-src 'self'` blocks the media host outright, so an image
 * resolved correctly still renders as nothing.
 *
 * Today the only way to get it is to copy the environment variable into the
 * consumer by hand. That is the shape this repo has already been bitten by
 * (`MAX_REASON_LENGTH` written out five times): two copies of one value agree
 * until one of them is edited, and the failure lands somewhere that does not
 * name the cause — here, images silently blocked by a policy that looks fine.
 *
 * ## Why an ORIGIN and a base URL, not just one
 *
 * CSP host-sources accept either. `img-src https://media.example.com` allows
 * the whole host; `img-src https://media.example.com/news/` restricts by path
 * prefix, which is tighter but interacts badly with redirects. Both are
 * legitimate choices for the consumer, and neither is ours to make — so both
 * values are reported and the caller picks.
 *
 * ## Unconfigured is a STATE, not an error
 *
 * `NEWS_MEDIA_R2_PUBLIC_BASE_URL` is unset in LAN/offline deployment profiles,
 * where media is not served at all. Answering 404 or 500 there would make a
 * build client fail on a perfectly valid deployment. It reports
 * `configured: false` instead, so a consumer can skip adding an `img-src` entry
 * rather than add a broken one — and can tell that apart from a request that
 * failed.
 */

export type MediaPublicOrigin = {
  /** `false` when the deployment serves no public media at all. */
  configured: boolean;
  /** Scheme + host + port, e.g. `https://media.example.com`. */
  origin: string | null;
  /** The full configured base, path included, without a trailing slash. */
  baseUrl: string | null;
};

const UNCONFIGURED: MediaPublicOrigin = {
  configured: false,
  origin: null,
  baseUrl: null
};

/**
 * Derives the reportable origin from a configured public base URL.
 *
 * A value that is set but unparseable is reported as UNCONFIGURED rather than
 * echoed back. Handing a consumer a malformed origin to put in a CSP header is
 * worse than telling it there is none: the policy would either be rejected
 * wholesale — taking every other directive with it — or silently allow
 * something nobody wrote down.
 */
export function deriveMediaPublicOrigin(
  publicBaseUrl: string
): MediaPublicOrigin {
  const trimmed = publicBaseUrl.trim();

  if (trimmed === "") return UNCONFIGURED;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return UNCONFIGURED;
  }

  // `http:`/`https:` only. A `file:`/`data:` base could not serve media over
  // the network anyway, and reporting one would put a scheme in a consumer's
  // `img-src` that means something entirely different there.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return UNCONFIGURED;
  }

  const baseUrl = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;

  return { configured: true, origin: parsed.origin, baseUrl };
}
