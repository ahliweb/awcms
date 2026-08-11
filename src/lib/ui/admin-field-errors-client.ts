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
  body: unknown
): Promise<FieldErrorResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
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
