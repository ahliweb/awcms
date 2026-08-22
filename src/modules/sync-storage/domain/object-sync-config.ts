/**
 * Env-based configuration for the object sync queue's filesystem boundary —
 * finding A7 of the 17 August 2026 audit round.
 *
 * Same shape as `data-lifecycle/domain/data-lifecycle-config.ts`: one
 * `resolve*Config` function, called at each composition root, never
 * `process.env` read ad hoc from deep inside domain code.
 *
 * ## Why a default rather than a required variable
 *
 * `OBJECT_SYNC_LOCAL_ROOT_PATH` defaults to `./var/object-sync`, matching
 * `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH`'s convention. A required variable would
 * have been stricter and worse: this ships into deployments that already have
 * queued rows and a working node protocol, and a config gate that stops the app
 * on upgrade is a much larger event than the finding — which needs a
 * compromised legitimate node with the deployment HMAC secret to reach at all.
 *
 * The default is not a loophole. Whatever the root is, the rule is the same:
 * `localPath` is relative to it and cannot leave it. A deployment whose objects
 * live elsewhere sets the variable; one that never enabled node sync is
 * unaffected either way.
 */
export const DEFAULT_OBJECT_SYNC_LOCAL_ROOT_PATH = "./var/object-sync";

export type ObjectSyncConfig = {
  /** The ONLY directory the dispatcher may read an object from. */
  localRootPath: string;
};

export function resolveObjectSyncConfig(
  env: NodeJS.ProcessEnv = process.env
): ObjectSyncConfig {
  const value = env.OBJECT_SYNC_LOCAL_ROOT_PATH;

  return {
    localRootPath:
      value && value.trim().length > 0
        ? value.trim()
        : DEFAULT_OBJECT_SYNC_LOCAL_ROOT_PATH
  };
}
