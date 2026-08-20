/**
 * The FORM half of `admin-form-client.ts`: the same same-origin cookie-auth
 * JSON mutation, plus the `error.details` array `sendJson` deliberately drops.
 *
 * Kept in its own module for the same CSP reason every helper here exists (an
 * imported `<script>` bundles to an external `/_astro/*.js`; an import-free one
 * is inlined and blocked), and split from `sendJson` along a real seam:
 * `sendJson` serves BUTTONS — publish, archive, purge — where the only useful
 * answer is "it failed, try again" and a field name would be meaningless. This
 * serves FORMS, where the operator can fix exactly one named field and cannot
 * fix anything if the screen will not say which.
 *
 * ## The defect that made it necessary
 *
 * `/admin/blog`'s create form answered every failure with "Check the title and
 * slug, then try again" while the field the API had actually rejected was
 * `contentText`. Advice pointing at the two fields that were CORRECT is worse
 * than no advice: it sends the author round a loop that cannot terminate,
 * which is precisely what happened — the form was unusable for months and the
 * message blamed the wrong thing the whole time.
 *
 * ## What is surfaced, and what is not
 *
 * Only the field NAMES, mapped through the caller's own label map. The
 * server's message string is never echoed, so the "generic copy only — never
 * surface internal detail" rule every other admin screen follows still holds:
 * an unknown field falls back to its own key, which is a name the form chose,
 * not a sentence the server wrote.
 */

import { mutateAndReload, type MessageBox } from "./admin-form-client";

/** One entry of the `ValidationError[]` that `fail(..., details)` carries for a `VALIDATION_ERROR`. */
export type ApiFieldError = {
  field: string;
  message: string;
};

export type FieldErrorResult = {
  ok: boolean;
  errorCode: string | null;
  fieldErrors: ApiFieldError[];
};

function readFieldErrors(details: unknown): ApiFieldError[] {
  if (!Array.isArray(details)) {
    return [];
  }

  // Shape-checked rather than cast: `details` is `unknown` on purpose — other
  // endpoints put other things there, and a screen must not render `undefined`
  // because one of them did.
  return details.filter(
    (entry): entry is ApiFieldError =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { field?: unknown }).field === "string" &&
      typeof (entry as { message?: unknown }).message === "string"
  );
}

/**
 * Sends a JSON body with COOKIE auth (`credentials: "same-origin"`, so the
 * session and tenant cookies ride along and no `X-AWCMS-Tenant-ID` header is
 * needed) and returns the narrow result plus any field errors. Never throws.
 *
 * No `Idempotency-Key` is sent or accepted: the endpoints behind admin FORMS —
 * `POST`/`PATCH` on posts and pages — require none by documented design, and
 * sending one would imply a replay contract they declined.
 */
export async function sendJsonWithFieldErrors(
  method: "POST" | "PATCH" | "PUT",
  url: string,
  body: unknown,
  /**
   * Extra request headers — in practice `Idempotency-Key`.
   *
   * Added for Issue #596: an endpoint can require an idempotency key AND
   * return field-level errors, and before this a caller had to choose. The
   * only way to have both was to drop to `sendJson` and lose the per-field
   * mapping, which is why `/admin/seo` reports "invalid" without saying which
   * field — a worse screen for no reason anybody chose.
   */
  extraHeaders?: Record<string, string>
): Promise<FieldErrorResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...extraHeaders },
      credentials: "same-origin",
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      error?: { code?: string; details?: unknown };
    } | null;

    if (response.ok && payload?.success === true) {
      return { ok: true, errorCode: null, fieldErrors: [] };
    }

    return {
      ok: false,
      errorCode: payload?.error?.code ?? null,
      fieldErrors: readFieldErrors(payload?.error?.details)
    };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR", fieldErrors: [] };
  }
}

/**
 * Turns field errors into one sentence naming the fields the API rejected, or
 * `null` when there are none to name (a conflict, a network failure) and the
 * caller should fall back to its own copy.
 *
 * Two API fields mapping to one control — `contentJson` and `contentText` are
 * both "Body" — collapse to a single mention, because naming the same textarea
 * twice reads as two separate problems.
 */
export function describeRejectedFields(
  fieldErrors: readonly ApiFieldError[],
  labels: Readonly<Record<string, string>>
): string | null {
  const named = [
    ...new Set(fieldErrors.map((error) => labels[error.field] ?? error.field))
  ];

  if (named.length === 0) {
    return null;
  }

  return `The server rejected ${named.join(", ")}. Correct ${
    named.length === 1 ? "that field" : "those fields"
  } and try again.`;
}

/**
 * The `mutateAndReload` lifecycle for a form that wants the REJECTED FIELDS
 * named — the four content forms on `/admin/blog` and `/admin/blog-pages`
 * (Issue #552).
 *
 * `mutateAndReload` maps a failure from the `errorCode` alone, which is right
 * for buttons and wrong here: the whole point of this module is the
 * `error.details` array that the narrow outcome shape drops. So the field
 * errors are captured on the way past and read by the failure mapper, which
 * only ever runs after the send has resolved.
 */
export async function submitWithFieldErrors(
  submit: HTMLButtonElement | null,
  box: MessageBox,
  method: "POST" | "PATCH" | "PUT",
  url: string,
  body: unknown,
  options: {
    labels: Readonly<Record<string, string>>;
    busyLabel: string;
    /** Shown for `SLUG_CONFLICT` / `CONFLICT`, which name no field. */
    conflict: string;
    failure: string;
    /**
     * Sends a fresh `Idempotency-Key` per submit. Required by every high-risk
     * mutation in this repo; a double-submit then replays the first result
     * instead of doing the work twice.
     */
    idempotent?: boolean;
  }
): Promise<void> {
  let rejected: ApiFieldError[] = [];

  await mutateAndReload(
    submit,
    box,
    async () => {
      const result = await sendJsonWithFieldErrors(
        method,
        url,
        body,
        options.idempotent === true
          ? { "Idempotency-Key": crypto.randomUUID() }
          : undefined
      );
      rejected = result.fieldErrors;
      return result;
    },
    (errorCode) =>
      errorCode === "SLUG_CONFLICT" || errorCode === "CONFLICT"
        ? options.conflict
        : (describeRejectedFields(rejected, options.labels) ?? options.failure),
    options.busyLabel
  );
}
