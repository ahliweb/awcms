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
 *
 * ## Provenance shown on the screen comes from `PIN.json`, not the fixture
 *
 * The fixture's own `omes_commit`/`generated_at` are DELIBERATE fixed
 * placeholders written by OMES's generator so the checked-in fixture
 * reproduces byte-for-byte (see `domain/architecture.ts`'s module doc) — they
 * are never real provenance and must never be rendered. The real answer to
 * "which OMES commit was this vendored from, and when" is
 * `contracts/v1/PIN.json` (`sourceCommit`/`syncedAt`, written by
 * `bun run contracts:omes:sync`), already exposed as `OMES_CONTRACT_PIN` by
 * `domain/contracts/index.ts`. This module attaches it to the projected
 * snapshot as `provenance` so `arsitektur.astro` never has to reach past this
 * layer for it.
 */
import {
  assertOmesContract,
  OMES_CONTRACT_PIN,
  type JsonValue
} from "../domain/contracts";
import { loadFixture } from "../domain/contracts/loader";
import {
  projectArchitectureSnapshot,
  type ProjectedArchitectureSnapshot
} from "../domain/architecture";

const ARCHITECTURE_SCHEMA_NAME = "architecture-capabilities-view";
const ARCHITECTURE_FIXTURE_FILE = "valid-01-generated.json";

/** How many leading hex characters of the full `sourceCommit` to show inline (the full value is always still available for a title/tooltip). */
const SOURCE_COMMIT_SHORT_LENGTH = 12;

export type ArchitectureProvenance = {
  /** Full `contracts/v1/PIN.json` `sourceCommit` — the real ahliweb/omes commit this snapshot was vendored from. */
  sourceCommit: string;
  /** First `SOURCE_COMMIT_SHORT_LENGTH` characters of `sourceCommit`, for compact display (pair with `sourceCommit` in a title/tooltip). */
  sourceCommitShort: string;
  /** `contracts/v1/PIN.json` `syncedAt` — when `bun run contracts:omes:sync` last re-vendored this snapshot. */
  vendoredAt: string;
};

export type ArchitectureSnapshotView = ProjectedArchitectureSnapshot & {
  provenance: ArchitectureProvenance;
};

let cached: ArchitectureSnapshotView | undefined;

/**
 * Loads, validates, and projects the pinned architecture-capabilities-view
 * snapshot, combined with the real vendoring provenance from `PIN.json`.
 * Cached at module scope — the vendored file and the pin only change via a
 * new deploy (a re-vendor + rebuild), never at request time, so re-reading
 * and re-validating them on every request would be pure overhead.
 */
export async function fetchArchitectureSnapshot(): Promise<ArchitectureSnapshotView> {
  if (cached) return cached;

  const { value, floatLiteralPaths } = await loadFixture(
    ARCHITECTURE_SCHEMA_NAME,
    ARCHITECTURE_FIXTURE_FILE
  );
  await assertOmesContract(ARCHITECTURE_SCHEMA_NAME, value as JsonValue, {
    floatLiteralPaths
  });

  const snapshot = projectArchitectureSnapshot(value as JsonValue);
  const pin = await OMES_CONTRACT_PIN;

  cached = {
    ...snapshot,
    provenance: {
      sourceCommit: pin.sourceCommit,
      sourceCommitShort: pin.sourceCommit.slice(0, SOURCE_COMMIT_SHORT_LENGTH),
      vendoredAt: pin.syncedAt
    }
  };
  return cached;
}

/** Test-only: clears the module-scope cache between test cases. */
export function resetArchitectureSnapshotCacheForTests(): void {
  cached = undefined;
}
