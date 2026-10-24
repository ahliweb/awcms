/**
 * "Is this media object safe to reference?" without the rest of the port
 * (Issue #1132).
 *
 * `mediaLibraryPortAdapter` also answers whether managed-media enforcement is
 * active, which evaluates deployment readiness, which reads the R2 credentials
 * and the `sync-storage` R2 pair. A caller that only asks whether a registry row
 * is safe (`blog:legacy:import` verifies a media map this way, against the
 * database and nothing else) should not import that, because `ops/run-job.sh`
 * hands a job every secret its import graph can reach (Issue #1120).
 *
 * This is the same query the adapter's `isMediaReferenceSafe` runs; the adapter
 * calls this function, so the two cannot disagree. Do not import
 * `managed-media-readiness`, `media-r2-config` or `media-r2-separation` here.
 */
import {
  fetchNewsMediaObjectById,
  isNewsMediaObjectSafeForPublicReference
} from "./media-object-directory";

export async function isMediaReferenceSafeForTenant(
  tx: Bun.SQL,
  tenantId: string,
  mediaObjectId: string
): Promise<boolean> {
  const media = await fetchNewsMediaObjectById(tx, tenantId, mediaObjectId);

  return (
    media !== null && isNewsMediaObjectSafeForPublicReference(media.status)
  );
}
