/**
 * Module-contributed search-source registry validation (ADR-0040 §3, ported from
 * awcms-micro Issue #270). Pure code-registry validation — no I/O, no database,
 * no network — the same shape as `data-lifecycle/domain/lifecycle-registry.ts`
 * and `reporting/domain/projection-registry.ts`. Every `SearchSourceDescriptor`
 * is declared by its OWNING module's own `module.ts`
 * (`ModuleDescriptor.searchSources`); this file only AGGREGATES
 * (`collectSearchSourceDescriptors`) and VALIDATES what modules already declared.
 * It never invents a descriptor and never reaches into another module's schema.
 *
 * The strict IDENTIFIER validation here is load-bearing: `site_search`'s generic
 * extraction engine interpolates a descriptor's table/column NAMES into SQL
 * (values are always bound parameters — see `search-document.ts`), so an invalid
 * identifier must fail the registry gate before any SQL is built. This is the
 * exact same discipline `data_lifecycle`'s generic executionMode uses
 * (`assertSafeIdentifier`).
 */
import type {
  ModuleDescriptor,
  SearchSourceDescriptor
} from "../../_shared/module-contract";

export const SEARCH_SOURCE_CONTRACT_VERSION = "1.0.0";

const DESCRIPTOR_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const TABLE_NAME_PATTERN = /^awcms_[a-z][a-z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/**
 * A URL template: absolute path, plus optional `:slug` / `:id` / `:tenantCode`
 * placeholders. `:tenantCode` is the AWCMS-specific addition over the awcms-micro
 * original — this base's public content routes are path-tenant-scoped
 * (`/blog/{tenantCode}/{slug}`, ADR-0009), not host-resolved `/news/:slug`.
 */
const URL_TEMPLATE_PATTERN = /^\/[A-Za-z0-9\-._~/:]*$/;

export type SearchSourceRegistryIssue = {
  descriptorKey: string;
  message: string;
};

export function formatSearchSourceRegistryIssue(
  issue: SearchSourceRegistryIssue
): string {
  return `[${issue.descriptorKey}] ${issue.message}`;
}

/**
 * A safe SQL identifier — snake_case, letter-first. Throws otherwise. The engine
 * calls this immediately before interpolating any descriptor-declared table/
 * column name into SQL, so even a descriptor that somehow bypassed the registry
 * gate cannot inject SQL.
 */
export function assertSafeIdentifier(name: string, role: string): string {
  if (typeof name !== "string" || !COLUMN_NAME_PATTERN.test(name)) {
    throw new Error(
      `site_search: unsafe ${role} identifier ${JSON.stringify(name)} — must be snake_case (^[a-z][a-z0-9_]*$).`
    );
  }
  return name;
}

/** A safe table name — must start with `awcms_`. Throws otherwise. */
export function assertSafeTableName(name: string): string {
  if (typeof name !== "string" || !TABLE_NAME_PATTERN.test(name)) {
    throw new Error(
      `site_search: unsafe table name ${JSON.stringify(name)} — must match ^awcms_[a-z][a-z0-9_]*$.`
    );
  }
  return name;
}

/** Flattens every registered module's own `searchSources` array into one list — the aggregation half. Order follows `listModules()`, deterministic. */
export function collectSearchSourceDescriptors(
  modules: readonly ModuleDescriptor[]
): SearchSourceDescriptor[] {
  return modules.flatMap((module) => module.searchSources ?? []);
}

/**
 * Every facet name the registry declares, deduplicated and sorted (Issue #633).
 *
 * This is the allow-list the public query endpoint parses request parameters
 * against. Deriving it from the descriptors rather than writing it down keeps
 * the endpoint honest: a module that adds a facet gets its query parameter
 * automatically, and a facet nobody declares is a parameter nobody can use to
 * probe the index.
 */
export function collectTermFacetKeys(
  modules: readonly ModuleDescriptor[]
): string[] {
  const keys = new Set<string>();

  for (const descriptor of collectSearchSourceDescriptors(modules)) {
    for (const facet of descriptor.termFacets ?? []) {
      if (typeof facet?.facetKey === "string" && facet.facetKey.length > 0) {
        keys.add(facet.facetKey);
      }
    }
  }

  return [...keys].sort();
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

/**
 * Validates the `termFacets` shape (Issue #633).
 *
 * The gate grows WITH the contract rather than after it, because every name in
 * a term facet is interpolated into SQL by `buildExtractionQuery`. That is the
 * whole reason `assertSafeIdentifier` exists, and the engine calls it again at
 * interpolation time — but a descriptor that reaches the engine with a bad
 * identifier is already a review failure, and this is where a reviewer finds
 * out instead of a worker crashing mid-index.
 *
 * `facetKey` gets the same snake_case rule as a column even though it is never
 * an identifier: it appears verbatim in a public response body and in a query
 * string, and one vocabulary for "what a machine-readable name looks like" is
 * cheaper than two.
 */
function validateTermFacets(
  push: (message: string) => void,
  descriptor: SearchSourceDescriptor
): void {
  const facets = descriptor.termFacets;

  if (facets === undefined) {
    return;
  }

  if (!Array.isArray(facets)) {
    push("termFacets must be an array when declared.");
    return;
  }

  const seen = new Set<string>();

  facets.forEach((facet, index) => {
    const at = `termFacets[${index}]`;

    if (!facet || typeof facet !== "object") {
      push(`${at} must be an object.`);
      return;
    }

    if (!facet.facetKey || !COLUMN_NAME_PATTERN.test(facet.facetKey)) {
      push(
        `${at}.facetKey must be snake_case (got ${JSON.stringify(facet.facetKey)}).`
      );
    } else if (seen.has(facet.facetKey)) {
      // Two facets under one name would silently merge in the response, and
      // the reader would see one list built from two vocabularies.
      push(`${at}.facetKey "${facet.facetKey}" is declared more than once.`);
    } else {
      seen.add(facet.facetKey);
    }

    if (facet.kind === "column") {
      checkColumn(push, facet.valueColumn, `${at}.valueColumn`, true);
      checkColumn(push, facet.labelColumn, `${at}.labelColumn`, false);
      return;
    }

    if (facet.kind !== "join") {
      push(
        `${at}.kind must be "column" or "join" (got ${JSON.stringify((facet as { kind?: unknown }).kind)}).`
      );
      return;
    }

    for (const [label, value] of [
      ["linkTable", facet.linkTable],
      ["valueTable", facet.valueTable]
    ] as const) {
      if (!value || !TABLE_NAME_PATTERN.test(value)) {
        push(
          `${at}.${label} must start with "awcms_" and be snake_case (got ${JSON.stringify(value)}).`
        );
      }
    }

    checkColumn(push, facet.linkSourceColumn, `${at}.linkSourceColumn`, true);
    checkColumn(push, facet.linkValueColumn, `${at}.linkValueColumn`, true);
    checkColumn(push, facet.valueIdColumn, `${at}.valueIdColumn`, true);
    checkColumn(push, facet.valueColumn, `${at}.valueColumn`, true);
    checkColumn(push, facet.labelColumn, `${at}.labelColumn`, true);
    checkColumn(
      push,
      facet.tenantColumn ?? "tenant_id",
      `${at}.tenantColumn`,
      true
    );

    for (const key of Object.keys(facet.valueEquals ?? {})) {
      checkColumn(push, key, `${at}.valueEquals["${key}"]`, true);
    }

    (facet.valueNullColumns ?? []).forEach((col: string, i: number) =>
      checkColumn(push, col, `${at}.valueNullColumns[${i}]`, true)
    );
  });
}

function validateSingleDescriptor(
  ownerModule: ModuleDescriptor,
  descriptor: SearchSourceDescriptor
): SearchSourceRegistryIssue[] {
  const issues: SearchSourceRegistryIssue[] = [];
  const push = (message: string) =>
    issues.push({ descriptorKey: descriptor.key || "(missing key)", message });

  if (!descriptor.key || !DESCRIPTOR_KEY_PATTERN.test(descriptor.key)) {
    push(
      `key must be non-empty and match "<module_key>.<name>" (got ${JSON.stringify(descriptor.key)}).`
    );
  }

  if (descriptor.ownerModuleKey !== ownerModule.key) {
    push(
      `ownerModuleKey (${JSON.stringify(descriptor.ownerModuleKey)}) must equal the declaring module's own key (${JSON.stringify(ownerModule.key)}) — a module must not declare a search source it claims another module owns.`
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
  checkColumn(push, descriptor.updatedAtColumn, "updatedAtColumn", true);
  checkColumn(push, descriptor.titleColumn, "titleColumn", true);
  checkColumn(push, descriptor.summaryColumn, "summaryColumn", false);
  checkColumn(push, descriptor.tagsColumn, "tagsColumn", false);
  checkColumn(push, descriptor.slugColumn, "slugColumn", false);

  validateTermFacets(push, descriptor);

  if (
    !Array.isArray(descriptor.bodyColumns) ||
    descriptor.bodyColumns.length === 0
  ) {
    push("bodyColumns must declare at least one column.");
  } else {
    descriptor.bodyColumns.forEach((col, index) =>
      checkColumn(push, col, `bodyColumns[${index}]`, true)
    );
  }

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

  if (
    !Number.isFinite(descriptor.weight) ||
    descriptor.weight <= 0 ||
    descriptor.weight > 10
  ) {
    push(`weight must be a number in (0, 10] (got ${descriptor.weight}).`);
  }

  if (descriptor.privacyClassification !== "public") {
    push(
      `privacyClassification must be "public" — only public content is admitted to the index (got ${JSON.stringify(descriptor.privacyClassification)}).`
    );
  }

  return issues;
}

export type SearchSourceRegistryValidationResult = {
  valid: boolean;
  issues: SearchSourceRegistryIssue[];
  descriptors: readonly SearchSourceDescriptor[];
};

/**
 * Validates the WHOLE registry (every module's contributed descriptors):
 * per-descriptor structural validity plus cross-descriptor invariants (unique
 * `key`, unique `(tableName, resourceType)` — two sources reading the same table
 * as the same resource type would produce duplicate documents).
 */
export function validateSearchSourceRegistry(
  modules: readonly ModuleDescriptor[]
): SearchSourceRegistryValidationResult {
  const issues: SearchSourceRegistryIssue[] = [];
  const allDescriptors: SearchSourceDescriptor[] = [];
  const seenKeys = new Map<string, number>();
  const seenTableType = new Map<string, number>();

  for (const module of modules) {
    for (const descriptor of module.searchSources ?? []) {
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
        message: `key is registered ${count} times — search-source keys must be unique across the whole registry.`
      });
    }
  }

  for (const [tt, count] of seenTableType) {
    if (count > 1) {
      issues.push({
        descriptorKey: tt,
        message: `(tableName, resourceType) "${tt}" is declared ${count} times — two sources reading the same table as the same resource type would produce duplicate documents.`
      });
    }
  }

  return { valid: issues.length === 0, issues, descriptors: allDescriptors };
}
