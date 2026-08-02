/**
 * Which permission keys are PLATFORM-scoped (ADR-0053).
 *
 * ## Why this reads code, not the database
 *
 * `awcms_permissions.scope` decides who a permission is GRANTED to. This set
 * decides whether the chokepoint demands the platform tenant at all — and those
 * must not be the same source, because a single UPDATE flipping a row to
 * `'tenant'` would then silently remove the gate along with the grant filter,
 * leaving a cross-tenant action guarded by nothing while every check still
 * reported green.
 *
 * Declaring it in the module descriptor makes the gate a property of the code
 * that ships. A database can lose the column's value; it cannot make
 * `access-guard.ts` stop asking. `tests/platform-scoped-permissions.test.ts`
 * binds the two together in both directions, so drift is loud rather than
 * silently one-sided.
 *
 * ## Cost
 *
 * Computed once, lazily, from the module registry — no query, and nothing runs
 * for a request whose permission is not in the set (the overwhelming majority).
 * The lazy call is deliberate: this file is reached from `access-guard.ts`,
 * which routes import, while `listModules()` pulls every `module.ts`. Resolving
 * it at call time rather than at module-evaluation time keeps that edge out of
 * the import graph's initialization order.
 */
import { listModules } from "../../index";
import { permissionKey } from "./access-control";

let cached: ReadonlySet<string> | null = null;

/**
 * Every `module.activity.action` whose descriptor declares
 * `scope: "platform"`. Memoized: the module registry is build-time constant.
 */
export function platformScopedPermissionKeys(): ReadonlySet<string> {
  if (cached) return cached;

  const keys = new Set<string>();

  for (const module of listModules()) {
    for (const permission of module.permissions ?? []) {
      if (permission.scope === "platform") {
        keys.add(
          permissionKey(module.key, permission.activityCode, permission.action)
        );
      }
    }
  }

  cached = keys;
  return cached;
}

export function isPlatformScopedPermissionKey(key: string): boolean {
  return platformScopedPermissionKeys().has(key);
}

/** Test seam — the registry is constant in production, never re-read. */
export function resetPlatformScopeCacheForTests(): void {
  cached = null;
}
