/**
 * `MediaPublicationRecheckPort` adapter (Issue #1145, residual L8 of
 * ADR-0157; capability `media_library` 1.1.0): `media_library`'s answer to "may
 * this media object STILL be published under the tenant's name?", asked by the
 * social dispatcher just before it calls a provider.
 *
 * The answer comes from the SECURITY DEFINER function
 * `awcms_social_source_media_state` (`sql/386`), whose EXECUTE is granted to
 * `awcms_social_dispatch` only, so that role never needs (and does not have) a
 * read of `awcms_news_media_objects`. `AVAILABLE` is the only eligible answer;
 * `MEDIA_RIGHTS_REVOKED` is passed on as such, and anything else (including an
 * unexpected value) is `MEDIA_UNAVAILABLE` (fail closed). A database error, a
 * tenant mismatch included, throws.
 *
 * Deliberately NOT part of `media-library-port-adapter.ts`: that file evaluates
 * deployment readiness, which reads the R2 credentials, and the dispatch job's
 * import graph decides which secrets `ops/run-job.sh` hands it (Issue #1120).
 * This file imports only the port type.
 */
import type {
  MediaPublicationRecheck,
  MediaPublicationRecheckPort
} from "../../_shared/ports/media-library-port";

export const mediaPublicationRecheckAdapter: MediaPublicationRecheckPort = {
  async recheckMediaForPublication(
    tx: Bun.SQL,
    input: { tenantId: string; mediaObjectId: string }
  ): Promise<MediaPublicationRecheck> {
    const rows = (await tx`
      SELECT awcms_social_source_media_state(
        ${input.tenantId}::uuid, ${input.mediaObjectId}::uuid
      ) AS state
    `) as { state: string | null }[];
    const state = rows[0]?.state;

    if (state === "AVAILABLE") return { eligible: true };

    if (state === "MEDIA_RIGHTS_REVOKED") {
      return { eligible: false, reason: "MEDIA_RIGHTS_REVOKED" };
    }

    return { eligible: false, reason: "MEDIA_UNAVAILABLE" };
  }
};
