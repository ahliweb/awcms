/**
 * Request-shape validation for the media object LIFECYCLE endpoints
 * (ADR-0056 §B: soft delete, restore, purge). Pure — no DB/network access,
 * same `{ valid: true; value } | { valid: false; errors }` convention as
 * `media-upload-session-validation.ts` beside it.
 *
 * ## Why this file exists rather than reusing `validateDeleteReasonInput`
 *
 * `blog_content/domain/content-validation.ts` already exports a shared
 * `{ reason: string }` validator, and three blog resources use it. Importing it
 * here would make `media_library` — a System Foundation module — depend on one
 * of its own CONSUMERS, which `module.ts` forbids in as many words: "media must
 * never depend on its own consumers". `modules:dag:check` would refuse the
 * edge, and it would be right to.
 *
 * So the shape is duplicated on purpose, and it is deliberately not identical:
 * the blog validator accepts any non-empty reason, while this one bounds the
 * length. A reason is written into an audit row that outlives the object it
 * describes; an unbounded one is a write-amplification path through an endpoint
 * whose whole point is destructive actions.
 */

export type ValidationError = {
  field: string;
  message: string;
};

/**
 * Bounds for the soft-delete reason. Exported because the `/admin/media` screen
 * renders `maxlength` from them — a hand-typed number there drifts into a
 * browser accepting what this validator rejects with a 400 the author cannot
 * act on (the same trap `/admin/blog` and `/admin/approvals` each hit).
 */
export const MIN_DELETE_REASON_LENGTH = 1;
export const MAX_DELETE_REASON_LENGTH = 500;

export type SoftDeleteMediaObjectInput = {
  reason: string;
};

export type SoftDeleteMediaObjectValidationResult =
  | { valid: true; value: SoftDeleteMediaObjectInput }
  | { valid: false; errors: ValidationError[] };

/**
 * `DELETE /api/v1/media/objects/{id}` body: `{ reason: string }`.
 *
 * The reason is REQUIRED, matching every other soft-delete surface in this repo
 * (`DELETE /api/v1/blog/posts/{id}`, `/api/v1/profiles/{id}`,
 * `/api/v1/email/templates/{id}`). It is trimmed before length-checking, so a
 * body of only whitespace fails as "required" rather than passing as a
 * 20-character reason that says nothing.
 */
export function validateSoftDeleteMediaObjectInput(
  body: unknown
): SoftDeleteMediaObjectValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const raw = record.reason;

  if (typeof raw !== "string" || raw.trim().length < MIN_DELETE_REASON_LENGTH) {
    return {
      valid: false,
      errors: [{ field: "reason", message: "reason is required." }]
    };
  }

  const reason = raw.trim();

  if (reason.length > MAX_DELETE_REASON_LENGTH) {
    return {
      valid: false,
      errors: [
        {
          field: "reason",
          message: `reason must be at most ${MAX_DELETE_REASON_LENGTH} characters.`
        }
      ]
    };
  }

  return { valid: true, value: { reason } };
}
