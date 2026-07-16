/**
 * Pure filtering/sorting logic for the module admin navigation registry. No
 * I/O here — the application layer (`application/navigation-registry.ts`)
 * collects candidates from each descriptor's `navigation` array
 * (`listModules()`) plus the tenant's disabled-module set, then hands both to
 * `filterVisibleNavigationEntries`.
 *
 * Navigation filtering is **not** authorization — every target page/API this
 * produces a link to must still enforce its own server-side guard regardless
 * of whether a link to it happens to be visible.
 */
import type { ModuleLifecycleStatus } from "../../_shared/module-contract";

export type NavigationCandidate = {
  moduleKey: string;
  moduleStatus: ModuleLifecycleStatus;
  labelKey: string;
  path: string;
  icon?: string;
  order: number;
  group?: string;
  requiredPermission?: string;
};

export type NavigationFilterOptions = {
  grantedPermissionKeys: ReadonlySet<string>;
  /** Module keys the tenant has explicitly disabled (`awcms_tenant_modules.enabled = false`). A module absent from this set is available by default — same convention as the tenant module lifecycle service. */
  tenantDisabledModuleKeys: ReadonlySet<string>;
};

/**
 * A candidate survives when all three hold:
 * 1. Its module isn't globally `disabled` (code/deployment-level — distinct
 *    from the tenant toggle below). `experimental`/`deprecated`/
 *    `maintenance` modules still show their nav — only `disabled` hides it.
 * 2. The tenant hasn't disabled that module.
 * 3. Either it declares no `requiredPermission` at all, or the caller holds
 *    that exact permission key.
 *
 * Survivors are sorted by `order` ascending (stable) for predictable
 * rendering — `group` is carried through but not used to group-render here
 * (the sidebar is still a flat list; grouped rendering is a UI concern for
 * whichever issue actually introduces grouped sections).
 */
export function filterVisibleNavigationEntries(
  candidates: readonly NavigationCandidate[],
  options: NavigationFilterOptions
): NavigationCandidate[] {
  return candidates
    .filter((candidate) => candidate.moduleStatus !== "disabled")
    .filter(
      (candidate) => !options.tenantDisabledModuleKeys.has(candidate.moduleKey)
    )
    .filter(
      (candidate) =>
        !candidate.requiredPermission ||
        options.grantedPermissionKeys.has(candidate.requiredPermission)
    )
    .sort((a, b) => a.order - b.order);
}
