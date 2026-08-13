/**
 * Aggregation of every module's `subjectData` array — ADR-0094, Issue #557.
 *
 * The same shape as `lifecycle-registry.ts`'s
 * `collectHighVolumeTableDescriptors`, and for the same reason: the OWNING
 * module declares, this file only gathers. It invents no descriptor and reaches
 * into no other module's schema (ADR-0013 §6).
 *
 * It lives here rather than in `scripts/` because the export and erasure
 * surfaces are runtime callers — a route importing a gate script would drag the
 * `sql/`-reading validator into the server bundle, and would make the registry
 * a thing only the CI process could see.
 */
import type {
  ModuleDescriptor,
  SubjectDataDescriptor
} from "../../_shared/module-contract";

/**
 * Sorted by key so the plan, the report and the admin screen agree on order
 * without each re-deciding it. An export whose table order shifts between two
 * runs of the same request looks, to the person reading it, like the contents
 * changed.
 */
export function collectSubjectDataDescriptors(
  modules: readonly ModuleDescriptor[]
): SubjectDataDescriptor[] {
  return modules
    .flatMap((module) => module.subjectData ?? [])
    .sort((a, b) => a.key.localeCompare(b.key));
}
