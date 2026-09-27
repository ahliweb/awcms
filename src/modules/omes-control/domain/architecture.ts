/**
 * Domain shape for the OMES Architecture Control Center screen (Issue
 * ahliweb/omes#246 part 3), projected from the vendored
 * `architecture-capabilities-view` v1 contract
 * (`src/modules/omes-control/contracts/v1/architecture-capabilities-view.schema.json`).
 *
 * ## This is a PINNED RELEASE SNAPSHOT, not live host state
 *
 * The vendored payload this module projects is the fixture
 * `contracts/v1/fixtures/architecture-capabilities-view/valid-01-generated.json`,
 * copied byte-for-byte from the OMES repository at the commit recorded in
 * `contracts/v1/PIN.json` (`bun run contracts:omes:sync`). It is NOT fetched
 * from a live, enrolled OMES host, and it does not change when a host's
 * actual architecture registry changes — only a re-vendor (a new commit,
 * reviewed and re-pinned) updates it. `application/architecture-directory.ts`
 * surfaces `omesVersion`/`omesCommit`/`generatedAt` from the payload itself
 * so the screen can say plainly which pinned snapshot it is showing, rather
 * than letting a reader assume live data.
 *
 * ## ADR-0017 boundary
 *
 * This is a read-only observability/reference projection: it carries no
 * control action, no ADR text, no evidence URLs, no removal triggers, and no
 * module implementation path beyond the bounded `omesModule` identifier —
 * the same structural guarantee the schema's own
 * `additionalProperties: false` enforces server-side in OMES (registry guard
 * C1, `lib/omes/py/architecture/registry.py`).
 */
import type { JsonValue } from "./contracts";

export type ExecutionSemantics =
  "probabilistic" | "deterministic" | "observational" | "external_authority";

export type ArchitecturePlaneId =
  | "business_control"
  | "host_control"
  | "agent_runtime"
  | "tool_data"
  | "infrastructure"
  | "observability";

export type CapabilityAuthority =
  | "omes"
  | "hermes"
  | "omarchy"
  | "awcms"
  | "graphify"
  | "provider"
  | "platform"
  | "external";

export type ImplementationStatus =
  | "implemented"
  | "delegated_upstream"
  | "staged"
  | "optional_external"
  | "logical_boundary";

export type ArchitecturePlane = {
  id: ArchitecturePlaneId;
  name: string;
  executionSemantics: ExecutionSemantics;
};

export type ArchitectureCapability = {
  id: string;
  name: string;
  plane: ArchitecturePlaneId;
  authority: CapabilityAuthority;
  executionSemantics: ExecutionSemantics;
  implementationStatus: ImplementationStatus;
  upstreamProject: string | null;
  omesModule: string | null;
};

export type ArchitectureLane = {
  plane: ArchitecturePlane;
  capabilities: ArchitectureCapability[];
};

export type ProjectedArchitectureSnapshot = {
  schemaVersion: string;
  omesVersion: string;
  omesCommit: string;
  generatedAt: string;
  lanes: ArchitectureLane[];
};

/** Raised when the vendored fixture's shape does not match this module's expectations. */
export class ArchitectureProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchitectureProjectionError";
  }
}

function asRecord(value: JsonValue, path: string): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArchitectureProjectionError(
      `${path}: expected an object in the architecture-capabilities-view payload`
    );
  }
  return value as Record<string, JsonValue>;
}

function asString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string") {
    throw new ArchitectureProjectionError(
      `${path}: expected a string in the architecture-capabilities-view payload`
    );
  }
  return value;
}

function asStringOrNull(
  value: JsonValue | undefined,
  path: string
): string | null {
  if (value === null || value === undefined) return null;
  return asString(value, path);
}

function asArray(value: JsonValue | undefined, path: string): JsonValue[] {
  if (!Array.isArray(value)) {
    throw new ArchitectureProjectionError(
      `${path}: expected an array in the architecture-capabilities-view payload`
    );
  }
  return value;
}

function toPlane(raw: JsonValue, path: string): ArchitecturePlane {
  const record = asRecord(raw, path);
  return {
    id: asString(record.id, `${path}.id`) as ArchitecturePlaneId,
    name: asString(record.name, `${path}.name`),
    executionSemantics: asString(
      record.execution_semantics,
      `${path}.execution_semantics`
    ) as ExecutionSemantics
  };
}

function toCapability(raw: JsonValue, path: string): ArchitectureCapability {
  const record = asRecord(raw, path);
  return {
    id: asString(record.id, `${path}.id`),
    name: asString(record.name, `${path}.name`),
    plane: asString(record.plane, `${path}.plane`) as ArchitecturePlaneId,
    authority: asString(
      record.authority,
      `${path}.authority`
    ) as CapabilityAuthority,
    executionSemantics: asString(
      record.execution_semantics,
      `${path}.execution_semantics`
    ) as ExecutionSemantics,
    implementationStatus: asString(
      record.implementation_status,
      `${path}.implementation_status`
    ) as ImplementationStatus,
    upstreamProject: asStringOrNull(
      record.upstream_project,
      `${path}.upstream_project`
    ),
    omesModule: asStringOrNull(record.omes_module, `${path}.omes_module`)
  };
}

/**
 * Projects an already schema-validated `architecture-capabilities-view`
 * payload into the typed, lane-grouped shape this screen renders.
 *
 * Callers MUST validate `payload` against the vendored schema first (see
 * `application/architecture-directory.ts`, which calls
 * `assertOmesContract("architecture-capabilities-view", payload)` before
 * this function ever runs) — this function trusts the shape it is given and
 * only re-derives the lane grouping, it does not re-validate.
 */
export function projectArchitectureSnapshot(
  payload: JsonValue
): ProjectedArchitectureSnapshot {
  const record = asRecord(payload, "$");

  const planes = asArray(record.planes, "$.planes").map((raw, index) =>
    toPlane(raw, `$.planes[${index}]`)
  );
  const capabilities = asArray(record.capabilities, "$.capabilities").map(
    (raw, index) => toCapability(raw, `$.capabilities[${index}]`)
  );

  const lanes: ArchitectureLane[] = planes.map((plane) => ({
    plane,
    capabilities: capabilities
      .filter((capability) => capability.plane === plane.id)
      .sort((a, b) => a.name.localeCompare(b.name))
  }));

  return {
    schemaVersion: asString(record.schema_version, "$.schema_version"),
    omesVersion: asString(record.omes_version, "$.omes_version"),
    omesCommit: asString(record.omes_commit, "$.omes_commit"),
    generatedAt: asString(record.generated_at, "$.generated_at"),
    lanes
  };
}
