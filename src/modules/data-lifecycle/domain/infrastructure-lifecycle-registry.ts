/**
 * Retention descriptors for tables owned by INFRASTRUCTURE rather than by a
 * module (ADR-0076, Issue #479).
 *
 * ## Why a second registry instead of a looser field
 *
 * `HighVolumeTableDescriptor.ownerModuleKey` must equal the declaring module's
 * own key, and `lifecycle-registry.ts` enforces it. That rule is correct: it is
 * what stops one module writing retention policy for another module's table.
 * What it never anticipated is a table with **no module owner at all**.
 *
 * `awcms_edge_cache_purges` is the first one, and its ownerlessness is a
 * recorded decision rather than an oversight — it lives in `src/lib/edge-cache/`,
 * which is deliberately not a module (like the database, rate-limit and SSRF
 * subsystems), and `scripts/table-write-ownership-check.ts` has classified it as
 * `"(src/lib infrastructure)"` since long before this file existed.
 *
 * Making `ownerModuleKey` optional would have saved this file and cost every
 * module descriptor its mandatory check: a descriptor that FORGOT the field
 * would stop being an error and start meaning "infrastructure". A typo would
 * become a silent ownership claim. Two registries make the choice explicit at
 * the point it is made.
 *
 * ## What stops this from becoming a parking lot
 *
 * Not a written rule — `scripts/data-lifecycle-registry-check.ts` re-uses
 * `ownerOfFile()`, the same function `modules:table-writes:check` already uses
 * to answer "who writes this table", and refuses a descriptor here whose table
 * is written by a module. Wrong ownership cannot be declared in either
 * direction, and no amount of careful prose gets around it.
 *
 * Pure: no I/O. The filesystem half of the gate lives in the script.
 */
import type {
  HighVolumeTableDescriptor,
  ModuleDescriptor
} from "../../_shared/module-contract";

import {
  collectHighVolumeTableDescriptors,
  DESCRIPTOR_KEY_PATTERN,
  formatLifecycleRegistryIssue,
  validateLifecycleDescriptorShape,
  type LifecycleRegistryIssue
} from "./lifecycle-registry";

export { formatLifecycleRegistryIssue };

/** `src/lib/<subsystem>/` — the directory that owns the schema, and the only owner form this registry accepts. */
const OWNER_PATH_PATTERN = /^src\/lib\/[a-z][a-z0-9-]*\/$/;

/**
 * A `HighVolumeTableDescriptor` minus the module it cannot name, plus the
 * directory that owns it instead.
 *
 * `executionMode` is narrowed to `"delegated"` by the type, not just by the
 * validator. The generic engine purges ON BEHALF OF the owning module; with no
 * module there is no behalf. An infrastructure table with no purge yet does not
 * get to discharge its obligation by pointing at the engine — it writes its
 * purge, exactly like a module does.
 */
export type InfrastructureLifecycleDescriptor = Omit<
  HighVolumeTableDescriptor,
  "ownerModuleKey" | "executionMode"
> & {
  ownerPath: string;
  executionMode: "delegated";
};

/** `awcms_edge_cache_purges` — ADR-0042's durable invalidation queue. */
export const EDGE_CACHE_PURGES_LIFECYCLE_KEY = "edge_cache.purges";

/**
 * How long a `done` row is kept. Mirrors `COMPLETED_RETENTION_DAYS` in
 * `scripts/edge-cache-purge.ts`, which is the code that actually deletes;
 * `tests/infrastructure-lifecycle-registry.test.ts` asserts the two agree, so
 * the descriptor cannot drift into describing a window nobody enforces.
 */
export const EDGE_CACHE_DONE_RETENTION_DAYS = 7;

/**
 * How long a `failed` row is kept — the number this descriptor could not have
 * been written without.
 *
 * `failed` rows were kept forever, deliberately: they are the only record that
 * an invalidation never landed, and deleting them silently would hide stale
 * content from the operator who needs to know. That reasoning bounds their
 * USEFUL life rather than extending it indefinitely — the content whose
 * invalidation failed has since expired from the edge thousands of times over,
 * so after six months the row is archaeology and the table is the only thing
 * still paying for it. Six months is far beyond any window in which somebody
 * acts on one.
 */
export const EDGE_CACHE_FAILED_RETENTION_DAYS = 180;

export const INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS: readonly InfrastructureLifecycleDescriptor[] =
  [
    {
      key: EDGE_CACHE_PURGES_LIFECYCLE_KEY,
      tableName: "awcms_edge_cache_purges",
      ownerPath: "src/lib/edge-cache/",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      // Two windows, one field triple. `done` is the ordinary case and the
      // default; `failed` is the ceiling. Stating only the shorter one would
      // describe a purge that does not exist.
      retentionMinDays: EDGE_CACHE_DONE_RETENTION_DAYS,
      defaultRetentionDays: EDGE_CACHE_DONE_RETENTION_DAYS,
      retentionMaxDays: EDGE_CACHE_FAILED_RETENTION_DAYS,
      partition: {
        eligible: false,
        rationale:
          "Pruned to a small working set every run, so a partition would be created and dropped faster than it earns its planning cost. The rows that survive longest are `failed`, and they are rare by construction — five delivery attempts each."
      },
      archive: {
        archivable: false,
        rationale:
          "A purge row is a surrogate-key ban token plus a reason string. It carries no personal data and no business record; once the ban has been sent (or has definitively failed and been seen), there is nothing in it worth restoring."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Anonymizing a surrogate key would leave a row that means nothing while still costing an index entry. There is no subject to protect — only disk to return."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "status", "created_at"],
          purpose:
            "The delegated prune filters on tenant + terminal status and orders by time; `awcms_edge_cache_purges_tenant_status_idx` (sql/068) already provides it, which is why this descriptor needs no migration of its own."
        }
      ],
      batchLimit: 1_000,
      backupRestoreNotes:
        "Safe to restore empty. A restored backup missing this queue loses pending invalidations, which self-heal as content is re-published or the edge TTL expires; restoring STALE rows is the worse direction, since a replayed ban is wasted Varnish work evaluated against every object.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run edge-cache:purge",
        purgeFunctionRef:
          "src/lib/edge-cache/purge-queue.ts:pruneCompletedEdgeCachePurges + pruneFailedEdgeCachePurges",
        description:
          "ADR-0042's own worker already pruned `done` rows past seven days; ADR-0076 added the `failed` ceiling and the legal-hold guard so the two functions together cover every terminal status the table has."
      }
    }
  ];

/**
 * Every descriptor key a legal hold may target — both registries.
 *
 * `legalHold.applicable: true` on an infrastructure descriptor is only true if
 * a hold can actually name it. Without this the flag would be a claim with no
 * way to exercise it, which is the failure this whole ADR is about.
 */
export function collectAllLifecycleDescriptorKeys(
  modules: readonly ModuleDescriptor[]
): string[] {
  return [
    ...collectHighVolumeTableDescriptors(modules).map(
      (descriptor) => descriptor.key
    ),
    ...INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS.map((descriptor) => descriptor.key)
  ];
}

export type InfrastructureLifecycleValidationResult = {
  valid: boolean;
  issues: LifecycleRegistryIssue[];
  descriptors: readonly InfrastructureLifecycleDescriptor[];
};

/**
 * The pure half of the gate: shape, owner-path form, and the invariant that a
 * table is never described twice.
 *
 * `moduleTableNames` is every table already described by a module descriptor.
 * The overlap check lives here rather than in the script because it needs no
 * filesystem — and because "described in two places" is the failure mode a
 * second registry introduces, so it should be impossible to run this validator
 * without checking for it.
 */
export function validateInfrastructureLifecycleRegistry(
  descriptors: readonly InfrastructureLifecycleDescriptor[],
  moduleTableNames: readonly string[],
  moduleKeys: readonly string[]
): InfrastructureLifecycleValidationResult {
  const issues: LifecycleRegistryIssue[] = [];
  const moduleTables = new Set(moduleTableNames);
  const registeredModuleKeys = new Set(moduleKeys);
  const seenKeys = new Map<string, number>();
  const seenTables = new Map<string, number>();

  for (const descriptor of descriptors) {
    const push = (message: string) =>
      issues.push({
        descriptorKey: descriptor.key || "(missing key)",
        message
      });

    issues.push(...validateLifecycleDescriptorShape(null, descriptor));

    // The key pattern is `<namespace>.<table_shortname>`, and for a module
    // descriptor the namespace IS a module key. An infrastructure key that
    // happened to match a registered module would read as that module's
    // descriptor everywhere a key is displayed — the exact "false claim that
    // reads as a decision" this registry was built to avoid. Checked rather
    // than trusted to naming discipline.
    const namespace = (descriptor.key ?? "").split(".")[0] ?? "";

    if (
      DESCRIPTOR_KEY_PATTERN.test(descriptor.key ?? "") &&
      registeredModuleKeys.has(namespace)
    ) {
      push(
        `key namespace "${namespace}" is a REGISTERED MODULE key — an infrastructure descriptor must not be keyed as though a module owned it. Either the table belongs to that module (declare it there) or the key needs a namespace that names no module.`
      );
    }

    if (!OWNER_PATH_PATTERN.test(descriptor.ownerPath ?? "")) {
      push(
        `ownerPath must be a "src/lib/<subsystem>/" directory (got ${JSON.stringify(descriptor.ownerPath)}) — an infrastructure descriptor names the directory that owns the schema, because it has no module key to name.`
      );
    }

    if (descriptor.executionMode !== "delegated") {
      push(
        `executionMode must be "delegated" (got ${JSON.stringify(descriptor.executionMode)}) — the generic engine purges on behalf of an owning module, and this table has none.`
      );
    }

    if (moduleTables.has(descriptor.tableName)) {
      push(
        `tableName "${descriptor.tableName}" is ALSO declared by a module's dataLifecycle array — a table has exactly one owner, and two descriptors for it means one of them is wrong.`
      );
    }

    seenKeys.set(descriptor.key, (seenKeys.get(descriptor.key) ?? 0) + 1);
    seenTables.set(
      descriptor.tableName,
      (seenTables.get(descriptor.tableName) ?? 0) + 1
    );
  }

  for (const [key, count] of seenKeys) {
    if (count > 1) {
      issues.push({
        descriptorKey: key,
        message: `key is registered ${count} times — descriptor keys must be unique across the whole registry.`
      });
    }
  }

  for (const [tableName, count] of seenTables) {
    if (count > 1) {
      issues.push({
        descriptorKey: tableName,
        message: `tableName "${tableName}" is registered ${count} times — a table must be declared by exactly one descriptor.`
      });
    }
  }

  return { valid: issues.length === 0, issues, descriptors };
}

/**
 * The filesystem half, as a pure function over an injected write census so a
 * test can feed it the defect it must catch.
 *
 * `writes` is `{ table, owner }` as produced by `collectTableWrites()`;
 * `infrastructureOwner` is the literal `ownerOfFile()` returns for a
 * `src/lib/` file. Passing it in rather than importing it keeps this module
 * free of the script layer — and makes the coupling visible, since a test that
 * passes the wrong literal fails loudly instead of silently matching nothing.
 */
export function findInfrastructureOwnershipProblems(
  descriptors: readonly InfrastructureLifecycleDescriptor[],
  writes: readonly { table: string; owner: string }[],
  infrastructureOwner: string
): LifecycleRegistryIssue[] {
  const issues: LifecycleRegistryIssue[] = [];

  for (const descriptor of descriptors) {
    const writers = writes.filter(
      (write) => write.table === descriptor.tableName
    );

    if (writers.length === 0) {
      issues.push({
        descriptorKey: descriptor.key,
        message: `no file in src/ writes "${descriptor.tableName}", so there is no evidence it is infrastructure-owned. A table nothing writes has a more urgent question than its retention window — see Issue #477.`
      });
      continue;
    }

    const moduleWriters = writers.filter(
      (write) => write.owner !== infrastructureOwner
    );

    if (moduleWriters.length > 0) {
      const owners = [...new Set(moduleWriters.map((write) => write.owner))];

      issues.push({
        descriptorKey: descriptor.key,
        message: `"${descriptor.tableName}" is written by ${owners.join(" + ")}, not by infrastructure. Declare its descriptor in that module's own \`dataLifecycle\` array; this registry is for tables no module owns, not for tables whose owner was inconvenient.`
      });
    }
  }

  return issues;
}
