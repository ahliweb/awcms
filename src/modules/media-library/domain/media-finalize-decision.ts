/**
 * Pure decision logic for the `finalize` step of the direct-to-R2 presigned
 * upload flow (Issue #634, epic `news_portal`). No I/O — the caller
 * (`application/news-media-r2-verification.ts`) has already done the real
 * `HEAD`/`GET` against R2 and the MIME sniffing/checksum computation; this
 * function only classifies the already-computed facts.
 *
 * Order follows `full-online-r2-architecture.md` §9 exactly (size is checked
 * earlier by the caller, from the `HEAD` result, before the full `GET` even
 * happens — see that module's own header comment for why): MIME sniffing
 * result against the allow-list, then against the client's claimed
 * `mimeType`, then (only if the client supplied one) the checksum claim
 * against the server-computed checksum. A checksum mismatch alone never
 * overrides a passing MIME sniff into a MIME acceptance and vice versa —
 * every check must pass (`full-online-r2-architecture.md` §9 point 6,
 * "defense in depth... tidak ada langkah yang dilewati").
 */

export type NewsMediaFinalizeRejectionReason =
  | "mime_not_recognized"
  | "mime_not_allowed"
  | "mime_mismatch"
  | "checksum_mismatch";

export type NewsMediaFinalizeDecision =
  | { accepted: true }
  | { accepted: false; reason: NewsMediaFinalizeRejectionReason };

export type NewsMediaFinalizeDecisionInput = {
  /** `mimeType` claimed when the upload session was created (step 1). */
  claimedMimeType: string;
  /** The deployment's configured allow-list (`news-media-r2-config.ts`). */
  allowedMimeTypes: string[];
  /**
   * Result of `sniffNewsMediaMimeType` against the bytes actually read from
   * R2 — `undefined` when the content matches no recognized image
   * signature (this is exactly what an HTML/JS payload disguised with a
   * `.jpg` name/claimed mime type sniffs to).
   */
  sniffedMimeType: string | undefined;
  /**
   * Optional client-claimed checksum from the finalize request. Per §9,
   * this is used ONLY to detect transport corruption — never as a
   * substitute for the MIME sniff above.
   */
  claimedChecksumSha256: string | null;
  /** SHA-256 computed server-side from the bytes actually read from R2. */
  computedChecksumSha256: string;
};

export function decideNewsMediaFinalizeOutcome(
  input: NewsMediaFinalizeDecisionInput
): NewsMediaFinalizeDecision {
  if (!input.sniffedMimeType) {
    return { accepted: false, reason: "mime_not_recognized" };
  }

  if (!input.allowedMimeTypes.includes(input.sniffedMimeType)) {
    return { accepted: false, reason: "mime_not_allowed" };
  }

  if (input.sniffedMimeType !== input.claimedMimeType.toLowerCase().trim()) {
    return { accepted: false, reason: "mime_mismatch" };
  }

  if (
    input.claimedChecksumSha256 &&
    input.claimedChecksumSha256.toLowerCase() !==
      input.computedChecksumSha256.toLowerCase()
  ) {
    return { accepted: false, reason: "checksum_mismatch" };
  }

  return { accepted: true };
}
