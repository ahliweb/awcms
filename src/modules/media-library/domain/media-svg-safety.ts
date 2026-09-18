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
 * element, an `on*=` event-handler attribute, a `javascript:`/`data:` URI in
 * `href`/`xlink:href`/`src`, or an externally-resolved entity can all run
 * script or leak data the moment the SVG is rendered inline or navigated to
 * directly. This module is the check that closes that gap, run by
 * `media-r2-verification.ts` ONLY when the sniffer has already classified
 * the bytes as `image/svg+xml` — a raster image is never scanned by this
 * (regex-based text) check, and an SVG classified `mime_not_allowed` because
 * the deployment's allow-list excludes it is rejected before this ever runs.
 *
 * ## Scope — a denylist, not a sanitizer, with three explicit closures
 *
 * This is a targeted denylist over the vectors an executable-XML image
 * format actually carries, not an attempt at a general-purpose SVG
 * sanitizer (an editorial upload flow that REJECTS an unsafe file is a
 * different, simpler problem than one that tries to REWRITE it into a safe
 * one — this module only does the former). A file that trips none of the
 * checks below is accepted; one that trips any is rejected outright, with no
 * partial acceptance/stripping.
 *
 * A denylist over literal patterns is only as strong as its resistance to
 * the attacker re-expressing the same semantics in a form the patterns don't
 * literally match. Three such re-expressions were found (PR #807 review)
 * and are closed here, each deliberately by REJECTING THE SHAPE outright
 * rather than trying to decode-and-re-check every possible encoding an
 * emblem/logo upload has no legitimate reason to use in the first place:
 *
 * 1. **A `data:` URI in `href`/`xlink:href`/`src`** can carry an entire
 *    nested `image/svg+xml` document (`<use xlink:href="data:image/svg+xml;
 *    base64,...">`), which a renderer that inlines `<use>`/`<image>`
 *    references evaluates as its own SVG — with its own `<script>`/`on*=`,
 *    none of which the OUTER document's literal text contains for the
 *    checks above to see. Closed by rejecting ANY `data:` URI in one of
 *    those three attributes outright (`data_uri`) — an institution logo
 *    never legitimately references image data through itself.
 * 2. **Character-reference obfuscation** — `&#106;avascript&#58;...` (decimal),
 *    `&#x6A;avascript&#x3a;...` (hex), or a stray TAB/LF/CR spliced into the
 *    scheme itself (`jav&#x09;ascript:...`, which browsers treat identically
 *    to `javascript:` because URL parsers strip TAB/LF/CR from the whole
 *    string before looking at the scheme) all decode/normalize to a
 *    `javascript:`/`data:` URI that the literal patterns alone never see in
 *    the raw bytes. Closed by decoding numeric (`&#NN;`)/hex (`&#xNN;`)
 *    character references and the five XML predefined named references,
 *    THEN stripping TAB/LF/CR (mirroring what a URL parser does), and
 *    running the URI/handler checks against that normalized text — see
 *    `normalizeForUriChecks`.
 * 3. **Parameter-entity splitting** —
 *    `<!ENTITY % p1 "SYST"><!ENTITY % p2 "EM \"file:///etc/passwd\"">` (with
 *    the parts combined into a third parameter entity, itself referenced
 *    from inside the DOCTYPE's internal subset) never puts the literal
 *    substring `SYSTEM`/`PUBLIC` inside any ONE declaration, so
 *    `EXTERNAL_ENTITY_PATTERN` alone never matches it — the XML parser
 *    reassembles the pieces long before any renderer would. Closed the same
 *    way as `data:`: rather than trying to trace parameter-entity
 *    expansion (a real XML parser's job, not a regex's), ANY `<!ENTITY`
 *    declaration at all is rejected (`entity_declaration`) — an institution
 *    logo/emblem has no legitimate reason to declare one, parameter or
 *    general, SYSTEM/PUBLIC or not.
 */

export type SvgSafetyViolation =
  | "script_element"
  | "event_handler_attribute"
  | "javascript_uri"
  | "data_uri"
  | "external_entity"
  | "entity_declaration";

/** `<script`, opening tag only — matches `<script>`, `<script/>`, `<script type="...">`, case-insensitively. */
const SCRIPT_ELEMENT_PATTERN = /<\s*script\b/i;

/**
 * An `on`-prefixed attribute name (`onload=`, `onclick=`, `onerror=`, ...)
 * preceded by whitespace, as every real attribute is. `\s` before `on`
 * deliberately excludes matching inside a longer word/attribute name (e.g. a
 * hypothetical `data-onload=` custom attribute) that merely contains `on...=`
 * as a substring — SVG/HTML event handlers are always their own attribute.
 * Run against `normalizeForUriChecks`'s output — see that function's header.
 */
const EVENT_HANDLER_ATTRIBUTE_PATTERN = /\son[a-z]+\s*=/i;

/** A `javascript:` URI scheme, wherever it appears (`href`, `xlink:href`, or any other attribute value). Run against `normalizeForUriChecks`'s output, which is what closes the character-reference/control-character obfuscation PR #807 review found — see that function's header. */
const JAVASCRIPT_URI_PATTERN = /javascript\s*:/i;

/**
 * A `data:` URI in `href`/`xlink:href`/`src` (PR #807 review, closure #1 —
 * see module header). `\bhref\b` also matches inside `xlink:href` (the `:`
 * before `href` is a non-word character, so `\b` holds), so one alternative
 * covers both attribute names without listing `xlink:href` separately.
 * Deliberately unconditional — ANY `data:` scheme in one of these
 * attributes is rejected, not just one that sniffs as `image/svg+xml`
 * itself: an institution logo has no legitimate reason to self-reference
 * data through any of them. Run against `normalizeForUriChecks`'s output.
 */
const DATA_URI_ATTRIBUTE_PATTERN = /\b(?:href|src)\s*=\s*["']?\s*data\s*:/i;

/**
 * A `<!DOCTYPE ...>` or `<!ENTITY ...>` declaration naming `SYSTEM` or
 * `PUBLIC` — the two keywords that make an entity/external DTD resolve
 * external content (a local file via `SYSTEM "file:///etc/passwd"`, or a
 * remote fetch), the classic XXE vector. Matches across the whole
 * declaration body (`[^>]*`) so a keyword anywhere inside
 * `<!ENTITY xxe SYSTEM "...">` is caught, not only immediately after the
 * entity name. Kept alongside the unconditional `ENTITY_DECLARATION_PATTERN`
 * below because a `<!DOCTYPE ... PUBLIC/SYSTEM ...>` with no `<!ENTITY` at
 * all (an external DTD reference on the doctype itself) is a distinct vector
 * that pattern does not cover.
 */
const EXTERNAL_ENTITY_PATTERN =
  /<!(?:DOCTYPE|ENTITY)\b[^>]*\b(?:SYSTEM|PUBLIC)\b/i;

/**
 * ANY `<!ENTITY` declaration, unconditionally (PR #807 review, closure #3 —
 * see module header). Parameter-entity splitting
 * (`<!ENTITY % p1 "SYST"><!ENTITY % p2 "EM ...">`) never puts `SYSTEM`/
 * `PUBLIC` inside one declaration, so `EXTERNAL_ENTITY_PATTERN` alone cannot
 * catch it — tracing parameter-entity expansion is a real XML parser's job,
 * not a regex's. An institution logo/emblem has no legitimate reason to
 * declare ANY entity, parameter (`%`) or general, so this rejects the shape
 * outright rather than trying to see through it.
 */
const ENTITY_DECLARATION_PATTERN = /<!ENTITY\b/i;

/** Numeric character reference, decimal — `&#106;` -> `j`. */
const DECIMAL_CHAR_REF_PATTERN = /&#(\d+);/g;
/** Numeric character reference, hex — `&#x6A;`/`&#X6a;` -> `j`. */
const HEX_CHAR_REF_PATTERN = /&#[xX]([0-9a-fA-F]+);/g;

/** The five XML-predefined named character references — the only named references XML itself guarantees without a DTD, and the ones an obfuscation attempt would actually reach for. */
const NAMED_CHAR_REFS: ReadonlyArray<readonly [RegExp, string]> = [
  [/&amp;/gi, "&"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&apos;/gi, "'"]
];

/** `null` for a code point no valid Unicode scalar value corresponds to (out of range, or a bare surrogate half `String.fromCodePoint` would otherwise throw on) — the caller leaves the original `&#...;` text untouched rather than guessing. */
function codePointToChar(codePoint: number): string | null {
  if (
    !Number.isFinite(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return null;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return null;
  }
}

/**
 * Decodes numeric/hex/the five named XML character references in `text` —
 * PR #807 review closure #2 (see module header). Every replacement here is a
 * single bounded quantified character class (`\d+`/`[0-9a-fA-F]+`) or a
 * fixed literal, never a nested/ambiguous quantifier, so this stays the same
 * linear, ReDoS-safe shape `media-mime-sniffer.ts`'s `looksLikeSvg` already
 * committed to (CodeQL js/redos was a real finding on an earlier version of
 * that function — same discipline applies here).
 */
function decodeCharacterReferences(text: string): string {
  let decoded = text.replace(HEX_CHAR_REF_PATTERN, (match, hex: string) => {
    return codePointToChar(Number.parseInt(hex, 16)) ?? match;
  });

  decoded = decoded.replace(DECIMAL_CHAR_REF_PATTERN, (match, dec: string) => {
    return codePointToChar(Number.parseInt(dec, 10)) ?? match;
  });

  for (const [pattern, replacement] of NAMED_CHAR_REFS) {
    decoded = decoded.replace(pattern, replacement);
  }

  return decoded;
}

/** TAB (`\t`), LF (`\n`), CR (`\r`) — the three bytes URL parsers (WHATWG URL spec, and every browser) strip from the ENTIRE string before inspecting a scheme, which is what lets `jav\tascript:` be evaluated as `javascript:`. */
const URL_NOISE_CHAR_PATTERN = /[\t\n\r]/g;

/**
 * Decode character references, then strip the control characters a URL
 * parser strips — PR #807 review closure #2. Used ONLY for the
 * attribute-value/URI-shaped checks (`EVENT_HANDLER_ATTRIBUTE_PATTERN`,
 * `JAVASCRIPT_URI_PATTERN`, `DATA_URI_ATTRIBUTE_PATTERN`): normalizing is a
 * pure superset of the raw text for THOSE checks (nothing about decoding
 * references or dropping TAB/LF/CR can hide a `javascript:`/`data:`/`on*=`
 * that was already there in plain form), so running them against the
 * normalized text only, rather than both, loses no detection.
 *
 * Deliberately NOT used for `SCRIPT_ELEMENT_PATTERN`/`EXTERNAL_ENTITY_PATTERN`/
 * `ENTITY_DECLARATION_PATTERN`: those match structural markup (an actual
 * `<script>`/`<!ENTITY` declaration), and character references are only
 * ever expanded inside attribute VALUES/text content by an XML parser, never
 * inside tag/attribute syntax itself — decoding before those checks would
 * risk a false trip on inert escaped text like `&lt;script&gt;` (which
 * renders as the literal, harmless string `<script>`, not an element).
 */
function normalizeForUriChecks(text: string): string {
  return decodeCharacterReferences(text).replace(URL_NOISE_CHAR_PATTERN, "");
}

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
  const normalized = normalizeForUriChecks(text);
  const violations: SvgSafetyViolation[] = [];

  if (SCRIPT_ELEMENT_PATTERN.test(text)) {
    violations.push("script_element");
  }

  if (EVENT_HANDLER_ATTRIBUTE_PATTERN.test(normalized)) {
    violations.push("event_handler_attribute");
  }

  if (JAVASCRIPT_URI_PATTERN.test(normalized)) {
    violations.push("javascript_uri");
  }

  if (DATA_URI_ATTRIBUTE_PATTERN.test(normalized)) {
    violations.push("data_uri");
  }

  if (EXTERNAL_ENTITY_PATTERN.test(text)) {
    violations.push("external_entity");
  }

  if (ENTITY_DECLARATION_PATTERN.test(text)) {
    violations.push("entity_declaration");
  }

  return violations;
}

/** Convenience boolean wrapper around `findSvgSafetyViolations` for a caller that only needs the yes/no answer. */
export function isSvgContentSafe(bytes: Uint8Array): boolean {
  return findSvgSafetyViolations(bytes).length === 0;
}
