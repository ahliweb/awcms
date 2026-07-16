/**
 * Pure per-descriptor permission filtering (Issue #753 follow-up, reviewer
 * finding on PR #781). `ProjectionDescriptor.requiredPermission`
 * (`_shared/module-contract.ts`) is REQUIRED (not optional) — every
 * registered projection declares its own permission a caller must hold to
 * read its snapshot/freshness/reconciliation. This is a SECOND, finer-
 * grained layer on top of the route's own coarse `authorizeInTransaction`
 * gate (`reporting.projections.read`/`.analyze`) — same "filter by the
 * candidate's own declared permission, not just the coarse endpoint gate"
 * pattern `module-management/domain/navigation-registry.ts`'s
 * `filterVisibleNavigationEntries` already establishes for admin nav.
 *
 * No I/O here — `application/projection-directory.ts` calls these pure
 * functions before/instead of doing any DB work for a descriptor the
 * caller isn't permitted to see at all.
 */
import type { ProjectionDescriptor } from "../../_shared/module-contract";

export function isProjectionPermitted(
  descriptor: ProjectionDescriptor,
  grantedPermissionKeys: ReadonlySet<string>
): boolean {
  return grantedPermissionKeys.has(descriptor.requiredPermission);
}

/** Keeps only descriptors the caller holds `requiredPermission` for — same "filter, never partially reveal" posture a LIST endpoint needs (a single-item lookup instead REJECTS with 403 rather than silently filtering, see the route's own handling). */
export function filterPermittedProjectionDescriptors(
  descriptors: readonly ProjectionDescriptor[],
  grantedPermissionKeys: ReadonlySet<string>
): ProjectionDescriptor[] {
  return descriptors.filter((descriptor) =>
    isProjectionPermitted(descriptor, grantedPermissionKeys)
  );
}
