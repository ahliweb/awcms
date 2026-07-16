/**
 * Module job/command registry service. Reads directly from `listModules()` —
 * never `awcms_module_jobs` — same reasoning as the navigation registry and
 * tenant module lifecycle: that table only reflects whatever
 * `bun run modules:sync` last wrote, and this is documentation the operator
 * reads, not something that should silently go stale until someone remembers
 * to sync. No I/O at all: every job descriptor is trusted,
 * statically-imported code metadata already in this process.
 */
import { listModules } from "../..";
import type { JobRegistryEntry } from "../domain/job-registry";

/** Every job declared by every registered module, or just one module's when `moduleKey` is given. `null` distinguishes "module not registered at all" from "registered but declares zero jobs" (still `[]`, a valid empty list). */
export function fetchModuleJobs(moduleKey?: string): JobRegistryEntry[] | null {
  if (moduleKey && !listModules().some((d) => d.key === moduleKey)) {
    return null;
  }

  return listModules()
    .filter((descriptor) => !moduleKey || descriptor.key === moduleKey)
    .flatMap((descriptor) =>
      (descriptor.jobs ?? []).map((job) => ({
        ...job,
        moduleKey: descriptor.key
      }))
    );
}
