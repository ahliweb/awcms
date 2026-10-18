/**
 * Web Push payload format (Issue #1106, ADR-0074) — pure.
 *
 * Two shapes travel inside the RFC 8291 envelope. The envelope, VAPID signing
 * and subscriptions are identical for both; only the plaintext JSON differs.
 *
 *   legacy       `{ title, body, targetPath?, data? }`
 *   declarative  `{ web_push: 8030, notification: { title, body?, navigate,
 *                  silent: false, tag?, data? } }` — WebKit Declarative Web
 *                  Push (https://webkit.org/blog/16535/).
 *
 * ## Why a switch, defaulting to `legacy`
 *
 * The producer must not emit the new shape until every service worker that
 * can still receive it understands it (`public/push-sw.js` reads both since
 * the same release). `PUSH_PAYLOAD_FORMAT` is therefore explicit and
 * defaults to `legacy`; rollback is flipping it back, with no subscription
 * or queue change. An unknown value also resolves to `legacy` (fail closed to
 * the format every deployed worker reads), and `config:validate` rejects it at
 * boot so the typo is found where an operator can act.
 *
 * ## `navigate` is derived, never trusted
 *
 * It must be an absolute `https:` URL on the configured public origin
 * (`APP_URL`) — never the request Host header, never a caller-supplied URL.
 * The queue only holds a validated same-origin `targetPath`
 * (`push-target-path.ts`); this module re-validates it and joins it onto the
 * configured origin, and the service worker checks the origin a third time.
 */
import { validatePushTargetPath } from "./push-target-path";
import type { PushMessage } from "./push-provider-contract";

export const PUSH_PAYLOAD_FORMATS = ["legacy", "declarative"] as const;
export type PushPayloadFormat = (typeof PUSH_PAYLOAD_FORMATS)[number];
export const DEFAULT_PUSH_PAYLOAD_FORMAT: PushPayloadFormat = "legacy";

/** Value of the `web_push` marker: the RFC number WebKit's declarative format cites. */
export const DECLARATIVE_WEB_PUSH_MARKER = 8030;

/** Per-field caps. A lock screen shows a few dozen characters; the rest only inflates what travels through a third party. */
export const DECLARATIVE_TITLE_MAX_CHARS = 120;
export const DECLARATIVE_BODY_MAX_CHARS = 240;
/** Whole serialized declarative payload. RFC 8291 allows 4096 B per record; stay well inside it. */
export const DECLARATIVE_PAYLOAD_MAX_BYTES = 2048;
/** `tag` and `data.category` are coalescing keys, not content. */
export const PUSH_TAG_MAX_CHARS = 64;
/** The legacy payload must always fit one RFC 8291 record (3,994 B of plaintext); stay below it. */
export const LEGACY_PAYLOAD_MAX_BYTES = 3500;

export function resolvePushPayloadFormat(
  env: NodeJS.ProcessEnv = process.env
): PushPayloadFormat {
  const configured = env.PUSH_PAYLOAD_FORMAT?.trim().toLowerCase();

  return configured === "declarative" ? "declarative" : "legacy";
}

export function isKnownPushPayloadFormat(
  value: string | undefined
): value is PushPayloadFormat {
  return (PUSH_PAYLOAD_FORMATS as readonly string[]).includes(value ?? "");
}

/**
 * The configured public origin, only if it can carry a declarative `navigate`:
 * an `https:` origin with no credentials. `http://localhost` (development)
 * returns `null`, which makes the producer stay on the legacy shape.
 */
export function resolvePushPublicOrigin(
  appUrl: string | undefined
): string | null {
  if (!appUrl) return null;

  try {
    const url = new URL(appUrl.trim());

    if (url.protocol !== "https:" || url.username || url.password) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export type PushNavigateResult =
  { ok: true; url: string } | { ok: false; reason: string };

/**
 * Build the absolute `navigate` URL from the configured origin and a queue
 * `targetPath`. Returns `ok:false` for anything that is not a same-origin path
 * on an https public origin; the caller then falls back to the admin root.
 */
export function buildPushNavigateUrl(
  publicOrigin: string | null,
  targetPath: string | undefined
): PushNavigateResult {
  if (!publicOrigin) {
    return { ok: false, reason: "no https public origin configured" };
  }

  if (targetPath === undefined || targetPath === "") {
    return { ok: true, url: `${publicOrigin}/admin` };
  }

  const checked = validatePushTargetPath(targetPath);

  if (!checked.valid) return { ok: false, reason: checked.reason };

  let resolved: URL;

  try {
    resolved = new URL(checked.path, publicOrigin);
  } catch {
    return { ok: false, reason: "targetPath is not joinable to the origin" };
  }

  // The same belt-and-braces comparison the service worker repeats.
  if (resolved.origin !== publicOrigin || resolved.protocol !== "https:") {
    return { ok: false, reason: "navigate resolved off the public origin" };
  }

  return { ok: true, url: resolved.href };
}

function truncate(value: string, max: number): string {
  const chars = Array.from(value);

  return chars.length <= max ? value : `${chars.slice(0, max - 1).join("")}…`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Legacy payload with the same title/body caps as the declarative one, and a
 * last-resort guarantee that it fits one encrypted record: an oversize `data`
 * is dropped, then the path is reduced to the admin root (omitted `targetPath`
 * means the worker opens `/admin`). A message that cannot be encrypted is lost
 * silently, so shrinking beats failing.
 */
export function buildLegacyPayload(message: PushMessage): string {
  const build = (withData: boolean, withPath: boolean) =>
    JSON.stringify({
      title: truncate(message.title ?? "", DECLARATIVE_TITLE_MAX_CHARS),
      body: truncate(message.body ?? "", DECLARATIVE_BODY_MAX_CHARS),
      ...(withPath && message.targetPath
        ? { targetPath: message.targetPath }
        : {}),
      ...(withData && message.data ? { data: message.data } : {})
    });

  for (const [withData, withPath] of [
    [true, true],
    [false, true],
    [false, false]
  ] as const) {
    const out = build(withData, withPath);

    if (byteLength(out) <= LEGACY_PAYLOAD_MAX_BYTES) return out;
  }

  return build(false, false);
}

/**
 * Declarative payload, or `null` when it cannot be built safely (empty title,
 * no https origin, over the size cap). `null` means "send legacy instead": a
 * fail-closed drop to the format every worker reads, never a half-valid
 * declarative message.
 *
 * An invalid `targetPath` does not null the payload; it navigates to the admin
 * root, matching the service worker's own fallback.
 */
export function buildDeclarativePayload(
  message: PushMessage,
  publicOrigin: string | null
): string | null {
  const title = (message.title ?? "").trim();

  if (title === "" || !publicOrigin) return null;

  const navigate = buildPushNavigateUrl(publicOrigin, message.targetPath);
  const url = navigate.ok ? navigate.url : `${publicOrigin}/admin`;
  const body = (message.body ?? "").trim();
  const category = message.data?.category;

  const serialized = JSON.stringify({
    web_push: DECLARATIVE_WEB_PUSH_MARKER,
    notification: {
      title: truncate(title, DECLARATIVE_TITLE_MAX_CHARS),
      ...(body ? { body: truncate(body, DECLARATIVE_BODY_MAX_CHARS) } : {}),
      navigate: url,
      silent: false,
      // Coalescing parity with the legacy path: same category, same tag.
      ...(typeof category === "string" &&
      category !== "" &&
      Array.from(category).length <= PUSH_TAG_MAX_CHARS
        ? { tag: category, data: { category } }
        : {})
    }
  });

  return new TextEncoder().encode(serialized).length >
    DECLARATIVE_PAYLOAD_MAX_BYTES
    ? null
    : serialized;
}

/** Entry point for the adapter: picks the shape, never throws, never emits an unsafe declarative message. */
export function buildPushPayload(
  message: PushMessage,
  options: { format: PushPayloadFormat; publicOrigin: string | null }
): string {
  if (options.format === "declarative") {
    const declarative = buildDeclarativePayload(message, options.publicOrigin);

    if (declarative !== null) return declarative;
  }

  return buildLegacyPayload(message);
}
