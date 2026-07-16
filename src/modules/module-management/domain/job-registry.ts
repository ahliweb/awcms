/**
 * Pure shape validation for module-declared job/command metadata. No I/O
 * here — the application layer (`application/job-registry.ts`) collects each
 * descriptor's own `jobs` array (`listModules()`) and hands the entries to
 * `validateJobDescriptor`.
 *
 * This is documentation-only, trusted code metadata (the `ModuleJobDescriptor`
 * contract) — it never executes anything (security note: no endpoint runs
 * arbitrary shell commands from this). "No secrets" is enforced by the same
 * review discipline as every other `ModuleDescriptor` field, not by an
 * automated content scanner here — a free-text `environmentNotes`/`purpose`
 * string has no reliable secret-shaped *key* to check.
 */
import type { ModuleJobDescriptor } from "../../_shared/module-contract";

export type JobRegistryEntry = ModuleJobDescriptor & { moduleKey: string };

export type JobDescriptorValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

const COMMAND_PATTERN = /^bun run [a-z0-9][a-z0-9:_-]*$/;

/**
 * `command` must look like `bun run <script>` (this repo is Bun-only, doc
 * 18 §Runtime & tooling — never `npm run`/a raw shell command) and
 * `purpose` must be a non-empty, human-readable explanation. Both
 * `recommendedSchedule` and `environmentNotes` are optional free text;
 * `safeInOfflineLan` is a plain boolean flag — none of these have a shape
 * to validate beyond "declared or not".
 */
export function validateJobDescriptor(
  job: ModuleJobDescriptor
): JobDescriptorValidationResult {
  const errors: string[] = [];

  if (!COMMAND_PATTERN.test(job.command)) {
    errors.push(`command "${job.command}" must look like "bun run <script>".`);
  }

  if (job.purpose.trim().length === 0) {
    errors.push("purpose must not be empty.");
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
