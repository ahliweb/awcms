/**
 * Commentable-resource resolution engine (ADR-0041 §3/§5, ported from
 * awcms-micro Issue #271). Confirms that a given (resourceType, resourceId,
 * locale) is a PUBLISHED, PUBLIC resource of THIS tenant, and resolves its
 * public URL.
 *
 * A comment is only ever accepted against, or displayed on, a resource that
 * passes this gate — so a draft, private, soft-deleted, or not-yet-scheduled
 * resource can neither receive comments nor expose the ones it already has.
 * That is the same source→projection discipline `site_search` applies at its
 * index boundary, and it is why the comment surface can never become an
 * oracle for unpublished content.
 *
 * ## How the SQL is built
 *
 * The descriptors are pure data. Literal filter VALUES are ALWAYS bound
 * parameters; only IDENTIFIERS (table and column names) are interpolated, and
 * each one is re-validated with `assertSafeTableName`/`assertSafeIdentifier`
 * immediately before interpolation — not merely at registry-validation time.
 * The registry gate and this second check are deliberately redundant: the gate
 * proves the committed registry is clean, this proves the string reaching
 * `tx.unsafe` is clean regardless of how it got here.
 *
 * This engine reaches into another module's table ONLY through that module's own
 * declared descriptor (ADR-0013 §6), never through an ad hoc cross-module
 * import or a hand-written join.
 *
 * ## Descriptors are a parameter, not an import
 *
 * Like `site_search`'s engine, nothing here imports `listModules()`. The
 * composition root `src/lib/comments/commentable-resources.ts` is the one place
 * that resolves the registry and passes descriptors in — which is also what
 * makes this file testable against a fixture registry.
 */
import type { CommentableResourceDescriptor } from "../../_shared/module-contract";
import {
  assertSafeIdentifier,
  assertSafeTableName,
  resolveDescriptorColumns
} from "../domain/commentable-resource-registry";

export type ResolvedCommentableResource = {
  descriptor: CommentableResourceDescriptor;
  resourceType: string;
  resourceId: string;
  locale: string;
  url: string;
};

export function findDescriptorByResourceType(
  descriptors: readonly CommentableResourceDescriptor[],
  resourceType: string
): CommentableResourceDescriptor | undefined {
  return descriptors.find((d) => d.resourceType === resourceType);
}

/**
 * Builds the resolved public URL from the descriptor's template plus row values.
 *
 * `:tenantCode` is the AWCMS-specific placeholder (this base's public content
 * routes are path-tenant-scoped, ADR-0009). A template that asks for it while
 * no code was supplied THROWS rather than substituting an empty string: a
 * silently malformed public URL would be served to every visitor of that page,
 * which is worse than a loud failure at resolution time. Same rule as
 * `site_search`'s `buildDocumentUrl`.
 */
export function buildCommentableResourceUrl(
  descriptor: CommentableResourceDescriptor,
  parts: { resourceId: string; slug: string | null; tenantCode?: string | null }
): string {
  let url = descriptor.urlTemplate;

  if (url.includes(":tenantCode")) {
    const code = parts.tenantCode;
    if (typeof code !== "string" || code.length === 0) {
      throw new Error(
        `comments: urlTemplate ${JSON.stringify(descriptor.urlTemplate)} for resource ${JSON.stringify(descriptor.key)} requires a tenantCode, but none was supplied.`
      );
    }
    url = url.split(":tenantCode").join(encodeURIComponent(code));
  }

  if (url.includes(":slug")) {
    const slug = parts.slug ?? parts.resourceId;
    url = url.split(":slug").join(encodeURIComponent(slug));
  }

  if (url.includes(":id")) {
    url = url.split(":id").join(encodeURIComponent(parts.resourceId));
  }

  return url;
}

/**
 * Confirms a resource is published and public for this tenant, returning it with
 * its resolved URL, or `null` when it does not exist or is not public. Runs
 * inside a caller-provided tenant transaction (RLS FORCE'd) — the explicit
 * `tenant_id` predicate below is belt-and-braces on top of RLS, because a
 * descriptor may point at a table whose tenant column is named something else.
 */
export async function resolvePublishedCommentableResource(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    resourceType: string;
    resourceId: string;
    locale: string;
    tenantCode?: string | null;
  },
  descriptors: readonly CommentableResourceDescriptor[]
): Promise<ResolvedCommentableResource | null> {
  const descriptor = findDescriptorByResourceType(
    descriptors,
    input.resourceType
  );
  if (!descriptor) return null;

  const table = assertSafeTableName(descriptor.tableName);
  const cols = resolveDescriptorColumns(descriptor);
  const tenantCol = assertSafeIdentifier(cols.tenantColumn, "tenantColumn");
  const idCol = assertSafeIdentifier(cols.idColumn, "idColumn");
  const localeCol = assertSafeIdentifier(cols.localeColumn, "localeColumn");
  const slugCol = cols.slugColumn
    ? assertSafeIdentifier(cols.slugColumn, "slugColumn")
    : null;

  const selectCols = slugCol
    ? `${idCol} AS __id, ${slugCol} AS __slug`
    : `${idCol} AS __id`;

  const clauses: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  // Mandatory tenant + id + locale scoping, before any descriptor-declared filter.
  clauses.push(`${tenantCol} = ${bind(tenantId)}`);
  clauses.push(`${idCol} = ${bind(input.resourceId)}`);
  clauses.push(`${localeCol} = ${bind(input.locale)}`);

  const filter = descriptor.publicationFilter;

  for (const [col, value] of Object.entries(filter.equals ?? {})) {
    clauses.push(`${assertSafeIdentifier(col, "equals")} = ${bind(value)}`);
  }
  for (const col of filter.notNullColumns ?? []) {
    clauses.push(`${assertSafeIdentifier(col, "notNull")} IS NOT NULL`);
  }
  for (const col of filter.nullColumns ?? []) {
    clauses.push(`${assertSafeIdentifier(col, "null")} IS NULL`);
  }
  for (const col of filter.timeReachedColumns ?? []) {
    clauses.push(`${assertSafeIdentifier(col, "timeReached")} <= now()`);
  }

  const sqlText = `SELECT ${selectCols} FROM ${table} WHERE ${clauses.join(" AND ")} LIMIT 1`;
  const rows = (await tx.unsafe(sqlText, params)) as Array<{
    __id: string;
    __slug?: string | null;
  }>;

  const row = rows[0];
  if (!row) return null;

  return {
    descriptor,
    resourceType: descriptor.resourceType,
    resourceId: input.resourceId,
    locale: input.locale,
    url: buildCommentableResourceUrl(descriptor, {
      resourceId: input.resourceId,
      slug: row.__slug ?? null,
      tenantCode: input.tenantCode ?? null
    })
  };
}
