/**
 * "Which staff may be picked for THIS?" — one shared, permission-scoped picker
 * query (Issue #1486, serving #1164 omnichannel assignees and the #1484 rule
 * editor's recipient picker).
 *
 * ## What it is, and what it is NOT
 *
 * It is NOT a user directory. It answers one narrow question for a caller that
 * has ALREADY been authorised (and, where the thing is scoped, has already been
 * shown to SEE it): of the people in this tenant, who could legitimately be
 * handed work that needs `permissionKey` at `scope`? A person who is not
 * eligible is simply absent, so the list can never be used to enumerate staff
 * beyond that eligibility, and an absent person is indistinguishable from a
 * person who does not exist.
 *
 * ## The rule (the SET form of `assigneeEligibility`)
 *
 * An eligible person is
 *
 * 1. an ACTIVE tenant user of this tenant who is a person (`principal_kind =
 *    'user'`: a delegated support actor is never offered);
 * 2. holding `permissionKey` on a TENANT-WIDE grant (a scoped grant's keys are
 *    not trusted to act tenant-wide, ADR-0080);
 * 3. if scope-CONFINED (any active, non-tenant business-scope assignment that
 *    has not ended, including one that has not started yet — the #1171/#1270
 *    fail-closed rule): the thing must be scoped and they must hold an active,
 *    STARTED assignment on that scope or one of its ancestors. An unresolved
 *    scope covers nobody confined; an unscoped thing is never offered to a
 *    confined person.
 *
 * `omnichannel_inbox`'s `assigneeEligibility` is the single-person form of the
 * same rule and stays the authority at WRITE time (the assignment endpoint
 * re-checks it); `tests/integration/eligible-staff-directory.integration.test.ts`
 * pins that this list is never wider than it.
 *
 * ## Bounded
 *
 * Keyset-paginated on `(display_name, id)`; the page size is capped. The
 * statement is one query (the permission holders are a CTE, not a probe per
 * person).
 */
import { tenantWidePermissionHolders } from "./auth-context";
import type { BusinessScopeHierarchyPort } from "../../_shared/ports/business-scope-hierarchy-port";

export type EligibleStaffScope = { type: string; id: string };

export type EligibleStaffCursor = { displayName: string; id: string };

export type EligibleStaffQuery = {
  limit: number;
  cursor: EligibleStaffCursor | null;
};

export type EligibleStaffMember = {
  tenantUserId: string;
  displayName: string;
};

export const ELIGIBLE_STAFF_DEFAULT_LIMIT = 25;
export const ELIGIBLE_STAFF_MAX_LIMIT = 50;
const MAX_CURSOR_LENGTH = 400;
const MAX_DISPLAY_NAME_LENGTH = 200;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeEligibleStaffCursor(last: EligibleStaffCursor): string {
  return Buffer.from(
    JSON.stringify({ n: last.displayName, i: last.id })
  ).toString("base64url");
}

function decodeCursor(raw: string): EligibleStaffCursor | null {
  if (raw.length > MAX_CURSOR_LENGTH) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as unknown;

    if (typeof parsed !== "object" || parsed === null) return null;

    const { n, i } = parsed as Record<string, unknown>;

    if (
      typeof n !== "string" ||
      n.length > MAX_DISPLAY_NAME_LENGTH ||
      typeof i !== "string" ||
      !UUID_PATTERN.test(i)
    ) {
      return null;
    }

    return { displayName: n, id: i.toLowerCase() };
  } catch {
    return null;
  }
}

/** `limit` and `cursor` only; anything else is a `400` (closed query set). Messages never echo a value. */
export function validateEligibleStaffQuery(
  params: URLSearchParams
):
  | { valid: true; value: EligibleStaffQuery }
  | { valid: false; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  for (const key of params.keys()) {
    if (key !== "limit" && key !== "cursor") {
      errors.push({ field: key, message: "Unknown query parameter." });
    }
  }

  const limitRaw = params.get("limit");
  const limit =
    limitRaw === null ? ELIGIBLE_STAFF_DEFAULT_LIMIT : Number(limitRaw);

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > ELIGIBLE_STAFF_MAX_LIMIT
  ) {
    errors.push({
      field: "limit",
      message: `limit must be an integer from 1 to ${ELIGIBLE_STAFF_MAX_LIMIT}.`
    });
  }

  const cursorRaw = params.get("cursor");
  const cursor = cursorRaw === null ? null : decodeCursor(cursorRaw);

  if (cursorRaw !== null && !cursor) {
    errors.push({ field: "cursor", message: "cursor is not valid." });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: { limit, cursor } };
}

export async function listEligibleStaff(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    /** `module.activity.action` the picked person must hold tenant-wide. */
    permissionKey: string;
    /** The business scope the work belongs to, or `null` for tenant-wide work. */
    scope: EligibleStaffScope | null;
  },
  query: EligibleStaffQuery,
  now: Date,
  hierarchy: BusinessScopeHierarchyPort
): Promise<{ items: EligibleStaffMember[]; nextCursor: string | null }> {
  let candidates: string[] = [];

  if (input.scope) {
    const resolution = await hierarchy.resolveScope(
      tx,
      tenantId,
      input.scope.type,
      input.scope.id
    );

    // An unresolved scope covers nobody confined (fail closed).
    if (resolution.resolved) {
      candidates = [
        `${input.scope.type}:${input.scope.id}`,
        ...resolution.ancestorScopes.map(
          (ancestor) => `${ancestor.scopeType}:${ancestor.scopeId}`
        )
      ];
    }
  }

  const noCursor = query.cursor === null;
  const cursorName = query.cursor?.displayName ?? "";
  const cursorId = query.cursor?.id ?? "00000000-0000-0000-0000-000000000000";
  const rows = (await tx`
    SELECT u.id, p.display_name
    FROM awcms_tenant_users u
    JOIN awcms_identities i ON i.id = u.identity_id AND i.tenant_id = u.tenant_id
    JOIN awcms_profiles p ON p.id = i.profile_id AND p.tenant_id = u.tenant_id
    WHERE u.tenant_id = ${tenantId}
      AND u.status = 'active'
      AND u.principal_kind = 'user'
      AND p.deleted_at IS NULL
      AND u.id IN (${tenantWidePermissionHolders(tx, tenantId, input.permissionKey)})
      AND (
        NOT EXISTS (
          SELECT 1 FROM awcms_business_scope_assignments c
          WHERE c.tenant_id = u.tenant_id
            AND c.tenant_user_id = u.id
            AND c.status = 'active'
            AND c.scope_type <> 'tenant'
            AND (c.effective_to IS NULL OR c.effective_to > ${now})
        )
        OR EXISTS (
          SELECT 1 FROM awcms_business_scope_assignments h
          WHERE h.tenant_id = u.tenant_id
            AND h.tenant_user_id = u.id
            AND h.status = 'active'
            AND h.scope_type <> 'tenant'
            AND h.effective_from <= ${now}
            AND (h.effective_to IS NULL OR h.effective_to > ${now})
            AND (h.scope_type || ':' || h.scope_id::text) = ANY(${tx.array(candidates, "text")})
        )
      )
      AND (${noCursor}::boolean OR (p.display_name, u.id) > (${cursorName}, ${cursorId}::uuid))
    ORDER BY p.display_name, u.id
    LIMIT ${query.limit + 1}
  `) as { id: string; display_name: string }[];

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];

  return {
    items: page.map((row) => ({
      tenantUserId: row.id,
      displayName: row.display_name
    })),
    nextCursor:
      rows.length > query.limit && last
        ? encodeEligibleStaffCursor({
            displayName: last.display_name,
            id: last.id
          })
        : null
  };
}
