/**
 * Module-contributed commentable-resource registry validation (ADR-0041 §3,
 * ported from awcms-micro Issue #271). Pure code-registry validation — no I/O,
 * no database, no network — the same shape as
 * `site-search/domain/search-source-registry.ts` and
 * `reporting/domain/projection-registry.ts`. Every `CommentableResourceDescriptor`
 * is declared by its OWNING module's own `module.ts`
 * (`ModuleDescriptor.commentableResources`); this file only AGGREGATES
 * (`collectCommentableResourceDescriptors`) and VALIDATES what modules already
 * declared. It never invents a descriptor and never reaches into another module's
 * schema.
 *
 * The strict IDENTIFIER validation here is load-bearing: `comments`'s engine
 * interpolates a descriptor's table/column NAMES into a publication-check SQL
 * (values are always bound parameters), so an invalid identifier must fail the
 * registry gate before any SQL is built — the exact discipline `site_search`'s
 * `assertSafeIdentifier` uses.
 */
import type {
  CommentableResourceDescriptor,
  ModuleDescriptor
} from "../../_shared/module-contract";

export const COMMENTABLE_RESOURCE_CONTRACT_VERSION = "1.0.0";

const DESCRIPTOR_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const TABLE_NAME_PATTERN = /^awcms_[a-z][a-z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/**
 * A URL template: absolute path, plus optional `:slug` / `:id` / `:tenantCode`
 * placeholders. `:tenantCode` is the AWCMS-specific addition over awcms-micro —
 * this base's public content routes are path-tenant-scoped
 * (`/blog/{tenantCode}/{slug}`, ADR-0009), not host-resolved `/news/:slug`. Same
 * addition `SearchSourceDescriptor.urlTemplate` carries.
 */
const URL_TEMPLATE_PATTERN = /^\/[A-Za-z0-9\-._~/:]*$/;

export const COMMENTABLE_POLICY_MODES = [
  "disabled",
  "authenticated-only",
  "moderated-anonymous",
  "moderated-registered"
] as const;

export type CommentableResourceRegistryIssue = {
  descriptorKey: string;
  message: string;
};

export function formatCommentableResourceRegistryIssue(
  issue: CommentableResourceRegistryIssue
): string {
  return `[${issue.descriptorKey}] ${issue.message}`;
}

/** A safe SQL identifier — snake_case, letter-first. Throws otherwise. Called immediately before interpolating any descriptor-declared column name into SQL. */
export function assertSafeIdentifier(name: string, role: string): string {
  if (typeof name !== "string" || !COLUMN_NAME_PATTERN.test(name)) {
    throw new Error(
      `comments: unsafe ${role} identifier ${JSON.stringify(name)} — must be snake_case (^[a-z][a-z0-9_]*$).`
    );
  }
  return name;
}

/**
 * A safe table name — must start with `awcms_`. Throws otherwise.
 *
 * This is a LEXICAL gate, not a catalog lookup: it proves the string cannot
 * carry SQL syntax, not that the table exists. Existence is proven by the
 * publication query actually running against it.
 */
export function assertSafeTableName(name: string): string {
  if (typeof name !== "string" || !TABLE_NAME_PATTERN.test(name)) {
    throw new Error(
      `comments: unsafe table name ${JSON.stringify(name)} — must match ^awcms_[a-z][a-z0-9_]*$.`
    );
  }
  return name;
}

/** Flattens every registered module's own `commentableResources` array into one list. Order follows `listModules()`, deterministic. */
export function collectCommentableResourceDescriptors(
  modules: readonly ModuleDescriptor[]
): CommentableResourceDescriptor[] {
  return modules.flatMap((module) => module.commentableResources ?? []);
}

function checkColumn(
  push: (message: string) => void,
  value: string | undefined | null,
  label: string,
  required: boolean
): void {
  if (value === undefined || value === null) {
    if (required) push(`${label} is required.`);
    return;
  }
  if (!COLUMN_NAME_PATTERN.test(value)) {
    push(
      `${label} must be a valid column name (got ${JSON.stringify(value)}).`
    );
  }
}

function validateSingleDescriptor(
  ownerModule: ModuleDescriptor,
  descriptor: CommentableResourceDescriptor
): CommentableResourceRegistryIssue[] {
  const issues: CommentableResourceRegistryIssue[] = [];
  const push = (message: string) =>
    issues.push({ descriptorKey: descriptor.key || "(missing key)", message });

  if (!descriptor.key || !DESCRIPTOR_KEY_PATTERN.test(descriptor.key)) {
    push(
      `key must be non-empty and match "<module_key>.<name>" (got ${JSON.stringify(descriptor.key)}).`
    );
  }

  if (descriptor.ownerModuleKey !== ownerModule.key) {
    push(
      `ownerModuleKey (${JSON.stringify(descriptor.ownerModuleKey)}) must equal the declaring module's own key (${JSON.stringify(ownerModule.key)}) — a module must not declare a commentable resource it claims another module owns.`
    );
  }

  if (
    !descriptor.resourceType ||
    !RESOURCE_TYPE_PATTERN.test(descriptor.resourceType)
  ) {
    push(
      `resourceType must be a snake_case identifier (got ${JSON.stringify(descriptor.resourceType)}).`
    );
  }

  if (!descriptor.tableName || !TABLE_NAME_PATTERN.test(descriptor.tableName)) {
    push(
      `tableName must start with "awcms_" and be snake_case (got ${JSON.stringify(descriptor.tableName)}).`
    );
  }

  checkColumn(
    push,
    descriptor.tenantColumn ?? "tenant_id",
    "tenantColumn",
    true
  );
  checkColumn(push, descriptor.idColumn ?? "id", "idColumn", true);
  checkColumn(push, descriptor.localeColumn, "localeColumn", true);
  checkColumn(push, descriptor.slugColumn, "slugColumn", false);

  if (
    !descriptor.urlTemplate ||
    !URL_TEMPLATE_PATTERN.test(descriptor.urlTemplate)
  ) {
    push(
      `urlTemplate must be an absolute path with only :slug/:id/:tenantCode placeholders (got ${JSON.stringify(descriptor.urlTemplate)}).`
    );
  } else if (
    descriptor.urlTemplate.includes(":slug") &&
    !descriptor.slugColumn
  ) {
    push("urlTemplate uses :slug but slugColumn is not declared.");
  }

  const filter = descriptor.publicationFilter;
  if (!filter || typeof filter !== "object") {
    push("publicationFilter is required.");
  } else {
    for (const key of Object.keys(filter.equals ?? {})) {
      checkColumn(push, key, `publicationFilter.equals["${key}"]`, true);
    }
    for (const [label, cols] of [
      ["notNullColumns", filter.notNullColumns],
      ["nullColumns", filter.nullColumns],
      ["timeReachedColumns", filter.timeReachedColumns]
    ] as const) {
      (cols ?? []).forEach((col, index) =>
        checkColumn(push, col, `publicationFilter.${label}[${index}]`, true)
      );
    }
  }

  if (!COMMENTABLE_POLICY_MODES.includes(descriptor.defaultPolicy)) {
    push(
      `defaultPolicy must be one of ${COMMENTABLE_POLICY_MODES.join(", ")} (got ${JSON.stringify(descriptor.defaultPolicy)}).`
    );
  }

  return issues;
}

export type CommentableResourceRegistryValidationResult = {
  valid: boolean;
  issues: CommentableResourceRegistryIssue[];
  descriptors: readonly CommentableResourceDescriptor[];
};

/**
 * Validates the WHOLE registry (every module's contributed descriptors):
 * per-descriptor structural validity plus cross-descriptor invariants (unique
 * `key`, unique `(tableName, resourceType)`).
 */
export function validateCommentableResourceRegistry(
  modules: readonly ModuleDescriptor[]
): CommentableResourceRegistryValidationResult {
  const issues: CommentableResourceRegistryIssue[] = [];
  const allDescriptors: CommentableResourceDescriptor[] = [];
  const seenKeys = new Map<string, number>();
  const seenTableType = new Map<string, number>();

  for (const module of modules) {
    for (const descriptor of module.commentableResources ?? []) {
      allDescriptors.push(descriptor);
      issues.push(...validateSingleDescriptor(module, descriptor));
      seenKeys.set(descriptor.key, (seenKeys.get(descriptor.key) ?? 0) + 1);
      const tt = `${descriptor.tableName}|${descriptor.resourceType}`;
      seenTableType.set(tt, (seenTableType.get(tt) ?? 0) + 1);
    }
  }

  for (const [key, count] of seenKeys) {
    if (count > 1) {
      issues.push({
        descriptorKey: key,
        message: `key is registered ${count} times — commentable-resource keys must be unique across the whole registry.`
      });
    }
  }

  for (const [tt, count] of seenTableType) {
    if (count > 1) {
      issues.push({
        descriptorKey: tt,
        message: `(tableName, resourceType) "${tt}" is declared ${count} times — two sources reading the same table as the same resource type would collide.`
      });
    }
  }

  return { valid: issues.length === 0, issues, descriptors: allDescriptors };
}

/**
 * Resolves a descriptor's effective column names with defaults applied — the
 * single place `tenantColumn`/`idColumn` defaults are materialized, so the engine
 * never re-derives them ad hoc.
 */
export function resolveDescriptorColumns(
  descriptor: CommentableResourceDescriptor
): {
  tenantColumn: string;
  idColumn: string;
  localeColumn: string;
  slugColumn: string | null;
} {
  return {
    tenantColumn: descriptor.tenantColumn ?? "tenant_id",
    idColumn: descriptor.idColumn ?? "id",
    localeColumn: descriptor.localeColumn,
    slugColumn: descriptor.slugColumn ?? null
  };
}
