/**
 * Orchestrates the finalize step's real R2 verification (Issue #634, epic
 * `news_portal`) — the fix for the security-auditor Critical finding on
 * Issue #631: `HEAD` alone is NEVER sufficient to promote a media object to
 * `verified`. This function performs, in this exact order
 * (`full-online-r2-architecture.md` §9, `r2-upload-sop.md` §2 step 5):
 *
 *   1. `HEAD` (via `NewsMediaR2Client.headObject`) — cheap existence +
 *      size fast-path, short-circuits before any full `GET` for a missing
 *      or (as R2 reports it right now) over-size object.
 *   2. Full `GET` (via `NewsMediaR2Client.getObject`), streamed and capped
 *      at `maxUploadBytes` — reads the object's actual bytes. This is the
 *      REAL size enforcement (PR #653 review, security-auditor Critical):
 *      `headObject`'s report can be stale by the time this runs (a
 *      presigned PUT URL is reusable, so the object at this key can be
 *      swapped for a much larger one between step 1 and step 2), so a
 *      `sizeExceeded` result here is treated as authoritative regardless of
 *      what `HEAD` reported a moment earlier.
 *   3. MIME sniffing from magic bytes (`sniffNewsMediaMimeType`) against
 *      the bytes from step 2 — NOT `Content-Type`, NOT the file extension,
 *      NOT the checksum.
 *   4. Server-side SHA-256 checksum, AND the authoritative `sizeBytes`,
 *      both computed from the SAME bytes actually read in step 2 — never
 *      from `head.sizeBytes`.
 *   5. `decideNewsMediaFinalizeOutcome` — the pure classification of the
 *      above against the allow-list/claimed mime type/claimed checksum.
 *
 * Deliberately takes no `Bun.SQL`/transaction — every call here is a
 * network call to R2 and must run strictly OUTSIDE any DB transaction
 * (ADR-0006). The caller (`application/news-media-finalize-upload-session.ts`)
 * runs this between two separate `withTenant` blocks, and only after having
 * already atomically claimed the row (`pending_upload -> uploaded`) in the
 * first of those — see that module's header for why (security-auditor
 * High finding, PR #653 review: without that claim, concurrent `finalize`
 * calls using different `Idempotency-Key`s would each reach this function
 * and each pay for their own `HEAD`+`GET` against the same object).
 */
import type { NewsMediaR2Client } from "../infrastructure/news-media-r2-client";
import { sniffNewsMediaMimeType } from "../domain/news-media-mime-sniffer";
import { decideNewsMediaFinalizeOutcome } from "../domain/news-media-finalize-decision";

export type VerifyNewsMediaR2ObjectInput = {
  objectKey: string;
  claimedMimeType: string;
  allowedMimeTypes: string[];
  maxUploadBytes: number;
  claimedChecksumSha256: string | null;
};

export type NewsMediaR2VerificationRejectionReason =
  | "object_not_found"
  | "size_exceeded"
  | "mime_not_recognized"
  | "mime_not_allowed"
  | "mime_mismatch"
  | "checksum_mismatch";

export type NewsMediaR2VerificationResult =
  | { outcome: "accepted"; sizeBytes: number; checksumSha256: string }
  | { outcome: "rejected"; reason: NewsMediaR2VerificationRejectionReason }
  | { outcome: "provider_error"; error: string };

export async function verifyNewsMediaR2Object(
  client: NewsMediaR2Client,
  input: VerifyNewsMediaR2ObjectInput
): Promise<NewsMediaR2VerificationResult> {
  const head = await client.headObject(input.objectKey);

  if (!head.ok) {
    return { outcome: "provider_error", error: head.error };
  }

  if (!head.exists) {
    return { outcome: "rejected", reason: "object_not_found" };
  }

  if (head.sizeBytes > input.maxUploadBytes) {
    // Fast-path only — still re-checked authoritatively below regardless.
    return { outcome: "rejected", reason: "size_exceeded" };
  }

  const get = await client.getObject(input.objectKey, input.maxUploadBytes);

  if (!get.ok) {
    return { outcome: "provider_error", error: get.error };
  }

  if (get.sizeExceeded) {
    // The authoritative check: the object actually read exceeds the cap,
    // regardless of what `HEAD` reported a moment earlier (TOCTOU — the
    // presigned PUT URL can be reused to swap the object between HEAD and
    // GET). No bytes were fully buffered for this outcome.
    return { outcome: "rejected", reason: "size_exceeded" };
  }

  const sniffedMimeType = sniffNewsMediaMimeType(get.bytes);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(get.bytes);
  const computedChecksumSha256 = hasher.digest("hex");

  const decision = decideNewsMediaFinalizeOutcome({
    claimedMimeType: input.claimedMimeType,
    allowedMimeTypes: input.allowedMimeTypes,
    sniffedMimeType,
    claimedChecksumSha256: input.claimedChecksumSha256,
    computedChecksumSha256
  });

  if (!decision.accepted) {
    return { outcome: "rejected", reason: decision.reason };
  }

  return {
    outcome: "accepted",
    // Authoritative — the length of the bytes actually read in step 2,
    // never `head.sizeBytes`.
    sizeBytes: get.bytes.byteLength,
    checksumSha256: computedChecksumSha256
  };
}
