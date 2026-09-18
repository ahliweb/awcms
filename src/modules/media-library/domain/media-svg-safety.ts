/**
 * SVG content-safety scan (Issue #806). Pure — no I/O, takes only the bytes
 * already read from R2 by the caller (`application/media-r2-verification.ts`),
 * the same convention `media-mime-sniffer.ts` follows.
 *
 * ## Why this exists, and why it did not until now
 *
 * `media-r2-config.ts` has, since Issue #635, allowed an operator to opt an
 * institution/tenant into `image/svg+xml` uploads via
 * `NEWS_MEDIA_R2_ALLOWED_MIME_TYPES` — SVG was always in
 * `NEWS_MEDIA_R2_KNOWN_MIME_TYPES`, deliberately excluded only from the
 * *default*. But `media-mime-sniffer.ts` never actually recognized SVG's
 * magic bytes before Issue #806, so that opt-in was a dead end: every SVG
 * upload sniffed to `undefined` and was hard-rejected as
 * `mime_not_recognized`, regardless of the allow-list. That made the
 * allow-list entry safe by ACCIDENT (nothing could ever reach the format),
 * not by a real content check — and Issue #806 needs SVG uploads to actually
 * work, because a regency emblem/institution logo is very often an SVG.
 *
 * Once the sniffer recognizes the shape (see that file's own header for why
 * SVG needs a text match rather than a byte signature), an SVG's danger is
 * no longer "can this be mistaken for an image" (the Issue #631 exploit) but
 * "is this image itself a script host" — SVG is executable XML: a `<script>`
 * element, an `on*=` event-handler attribute, a `javascript:` URI in `href`/
 * `xlink:href`, or an externally-resolved entity can all run script or leak
 * data the moment the SVG is rendered inline or navigated to directly. This
 * module is the check that closes that gap, run by
 * `media-r2-verification.ts` ONLY when the sniffer has already classified
 * the bytes as `image/svg+xml` — a raster image is never scanned by this
 * (regex-based text) check, and an SVG classified `mime_not_allowed` because
 * the deployment's allow-list excludes it is rejected before this ever runs.
 *
 * ## Scope — matches the issue's four named vectors exactly
 *
 * This is a targeted denylist over the four vectors Issue #806 names, not an
 * attempt at a general-purpose SVG sanitizer (an editorial upload flow that
 * REJECTS an unsafe file is a different, simpler problem than one that tries
 * to REWRITE it into a safe one — this module only does the former). A file
 * that trips none of the four checks below is accepted; one that trips any
 * is rejected outright, with no partial acceptance/stripping.
 */

export type SvgSafetyViolation =
  | "script_element"
  | "event_handler_attribute"
  | "javascript_uri"
  | "external_entity";

/** `<script`, opening tag only — matches `<script>`, `<script/>`, `<script type="...">`, case-insensitively. */
const SCRIPT_ELEMENT_PATTERN = /<\s*script\b/i;

/**
 * An `on`-prefixed attribute name (`onload=`, `onclick=`, `onerror=`, ...)
 * preceded by whitespace, as every real attribute is. `\s` before `on`
 * deliberately excludes matching inside a longer word/attribute name (e.g. a
 * hypothetical `data-onload=` custom attribute) that merely contains `on...=`
 * as a substring — SVG/HTML event handlers are always their own attribute.
 */
const EVENT_HANDLER_ATTRIBUTE_PATTERN = /\son[a-z]+\s*=/i;

/** A `javascript:` URI scheme, wherever it appears (`href`, `xlink:href`, or any other attribute value) — whitespace is allowed around the colon because browsers tolerate it too (`java\tscript:` variants are NOT handled here; see module header's "targeted denylist" note). */
const JAVASCRIPT_URI_PATTERN = /javascript\s*:/i;

/**
 * A `<!DOCTYPE ...>` or `<!ENTITY ...>` declaration naming `SYSTEM` or
 * `PUBLIC` — the two keywords that make an entity resolve external content
 * (a local file via `SYSTEM "file:///etc/passwd"`, or a remote fetch), the
 * classic XXE vector. Matches across the whole declaration body (`[^>]*`) so
 * a keyword anywhere inside `<!ENTITY xxe SYSTEM "...">` is caught, not only
 * immediately after the entity name.
 */
const EXTERNAL_ENTITY_PATTERN =
  /<!(?:DOCTYPE|ENTITY)\b[^>]*\b(?:SYSTEM|PUBLIC)\b/i;

/**
 * Every violation `bytes` trips, in a fixed, deterministic order — empty
 * when the content is safe. Decodes the WHOLE payload (unlike the sniffer's
 * bounded-prefix shape match): a script element or external entity can
 * legitimately sit anywhere in a real SVG, not only near the top, and this
 * check only ever runs on an object already capped by
 * `NEWS_MEDIA_R2_MAX_UPLOAD_BYTES` (`media-r2-verification.ts` calls this
 * only after the size-capped `GET` has already completed), so decoding the
 * whole thing is bounded by that same ceiling.
 */
export function findSvgSafetyViolations(
  bytes: Uint8Array
): SvgSafetyViolation[] {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const violations: SvgSafetyViolation[] = [];

  if (SCRIPT_ELEMENT_PATTERN.test(text)) {
    violations.push("script_element");
  }

  if (EVENT_HANDLER_ATTRIBUTE_PATTERN.test(text)) {
    violations.push("event_handler_attribute");
  }

  if (JAVASCRIPT_URI_PATTERN.test(text)) {
    violations.push("javascript_uri");
  }

  if (EXTERNAL_ENTITY_PATTERN.test(text)) {
    violations.push("external_entity");
  }

  return violations;
}

/** Convenience boolean wrapper around `findSvgSafetyViolations` for a caller that only needs the yes/no answer. */
export function isSvgContentSafe(bytes: Uint8Array): boolean {
  return findSvgSafetyViolations(bytes).length === 0;
}
