/**
 * Read-side loader for `/admin/omes/arsitektur` (Issue ahliweb/omes#246
 * part 3).
 *
 * Unlike every other screen under `src/pages/admin/omes/*`, this one has no
 * database table and no tenant-scoped query: the data is a PINNED, VENDORED
 * SNAPSHOT (`src/modules/omes-control/contracts/v1/fixtures/
 * architecture-capabilities-view/valid-01-generated.json`), re-vendored from
 * an OMES commit via `bun run contracts:omes:sync` (never hand-edited — see
 * `PIN.json`'s SHA-256 pin and `bun run contracts:omes:sync:check`, the
 * drift gate). Every tenant sees the exact same snapshot; there is nothing
 * to scope by tenant because it describes the OMES/Hermes/AWCMS reference
 * architecture, not this tenant's own host fleet.
 *
 * `assertOmesContract` validates the fixture against the vendored schema
 * BEFORE `projectArchitectureSnapshot` (domain/architecture.ts) touches it —
 * fail closed, same discipline every other OMES contract consumer in this
 * module follows (`domain/contracts/index.ts`'s module doc).
 */
import { assertOmesContract, type JsonValue } from "../domain/contracts";
import { loadFixture } from "../domain/contracts/loader";
import {
  projectArchitectureSnapshot,
  type ProjectedArchitectureSnapshot
} from "../domain/architecture";

const ARCHITECTURE_SCHEMA_NAME = "architecture-capabilities-view";
const ARCHITECTURE_FIXTURE_FILE = "valid-01-generated.json";

let cached: ProjectedArchitectureSnapshot | undefined;

/**
 * Loads, validates, and projects the pinned architecture-capabilities-view
 * snapshot. Cached at module scope — the vendored file only changes via a
 * new deploy (a re-vendor + rebuild), never at request time, so re-reading
 * and re-validating it on every request would be pure overhead.
 */
export async function fetchArchitectureSnapshot(): Promise<ProjectedArchitectureSnapshot> {
  if (cached) return cached;

  const { value, floatLiteralPaths } = await loadFixture(
    ARCHITECTURE_SCHEMA_NAME,
    ARCHITECTURE_FIXTURE_FILE
  );
  await assertOmesContract(ARCHITECTURE_SCHEMA_NAME, value as JsonValue, {
    floatLiteralPaths
  });

  cached = projectArchitectureSnapshot(value as JsonValue);
  return cached;
}

/** Test-only: clears the module-scope cache between test cases. */
export function resetArchitectureSnapshotCacheForTests(): void {
  cached = undefined;
}
