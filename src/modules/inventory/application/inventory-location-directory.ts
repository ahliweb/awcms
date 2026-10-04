/**
 * Stock locations and the negative-stock policy (Issue #887, ADR-0126).
 *
 * Every query filters `tenant_id` explicitly even though RLS already does: the
 * explicit predicate is what lets the planner use the `(tenant_id, …)` indexes,
 * and it keeps the query correct for a caller that is (wrongly) connected as a
 * role that bypasses RLS.
 *
 * Locations are never deleted — a location with movements cannot go away without
 * orphaning ledger rows, so the lifecycle is `active` <-> `inactive` (ADR-0126
 * §6). An inactive location refuses new postings but keeps its history readable.
 */
import {
  DEFAULT_NEGATIVE_STOCK_POLICY,
  type NegativeStockPolicy
} from "../domain/inventory-types";
import type {
  CreateLocationInput,
  UpdateLocationInput
} from "../domain/inventory-validation";
import { resolveTenantNegativeStockPolicy } from "./inventory-ledger";
import {
  mapLocation,
  type LocationRow,
  type StockLocation
} from "./inventory-rows";

export const MAX_LOCATION_PAGE_SIZE = 200;
export const DEFAULT_LOCATION_PAGE_SIZE = 100;

export type CreateLocationResult =
  | { outcome: "created"; location: StockLocation }
  | { outcome: "code_conflict" }
  | { outcome: "office_not_found" };

async function officeExists(
  tx: Bun.SQL,
  tenantId: string,
  officeId: string
): Promise<boolean> {
  const rows = await tx`
    SELECT 1 FROM awcms_offices
    WHERE tenant_id = ${tenantId} AND id = ${officeId} AND deleted_at IS NULL
  `;

  return rows.length > 0;
}

export async function createLocation(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  input: CreateLocationInput
): Promise<CreateLocationResult> {
  if (input.officeId && !(await officeExists(tx, tenantId, input.officeId))) {
    return { outcome: "office_not_found" };
  }

  const rows = (await tx`
    INSERT INTO awcms_inventory_locations
      (tenant_id, code, name, office_id, created_by, updated_by)
    VALUES (${tenantId}, ${input.code}, ${input.name}, ${input.officeId},
            ${actorTenantUserId}, ${actorTenantUserId})
    ON CONFLICT (tenant_id, code) DO NOTHING
    RETURNING id, code, name, office_id, status, negative_stock_policy,
              created_at, updated_at
  `) as LocationRow[];

  return rows[0]
    ? { outcome: "created", location: mapLocation(rows[0]) }
    : { outcome: "code_conflict" };
}

export async function getLocation(
  tx: Bun.SQL,
  tenantId: string,
  locationId: string
): Promise<StockLocation | null> {
  const rows = (await tx`
    SELECT id, code, name, office_id, status, negative_stock_policy,
           created_at, updated_at
    FROM awcms_inventory_locations
    WHERE tenant_id = ${tenantId} AND id = ${locationId}
  `) as LocationRow[];

  return rows[0] ? mapLocation(rows[0]) : null;
}

export type ListLocationsOptions = {
  status?: "active" | "inactive";
  /** Keyset: the last `code` of the previous page. */
  after?: string;
  limit?: number;
};

export async function listLocations(
  tx: Bun.SQL,
  tenantId: string,
  options: ListLocationsOptions
): Promise<{ items: StockLocation[]; nextCursor: string | null }> {
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_LOCATION_PAGE_SIZE, 1),
    MAX_LOCATION_PAGE_SIZE
  );
  const status = options.status ?? null;
  const after = options.after ?? null;

  const rows = (await tx`
    SELECT id, code, name, office_id, status, negative_stock_policy,
           created_at, updated_at
    FROM awcms_inventory_locations
    WHERE tenant_id = ${tenantId}
      AND (${status}::text IS NULL OR status = ${status})
      AND (${after}::text IS NULL OR code > ${after})
    ORDER BY code ASC
    LIMIT ${limit + 1}
  `) as LocationRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map(mapLocation),
    nextCursor: hasMore ? page[page.length - 1]!.code : null
  };
}

export type UpdateLocationResult =
  | { outcome: "updated"; location: StockLocation; before: StockLocation }
  | { outcome: "not_found" }
  | { outcome: "office_not_found" };

export async function updateLocation(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  locationId: string,
  patch: UpdateLocationInput
): Promise<UpdateLocationResult> {
  const before = await getLocation(tx, tenantId, locationId);

  if (!before) {
    return { outcome: "not_found" };
  }

  if (patch.officeId && !(await officeExists(tx, tenantId, patch.officeId))) {
    return { outcome: "office_not_found" };
  }

  const nextName = patch.name ?? before.name;
  const nextOffice =
    patch.officeId === undefined ? before.officeId : patch.officeId;
  const nextStatus = patch.status ?? before.status;

  const rows = (await tx`
    UPDATE awcms_inventory_locations
    SET name = ${nextName}, office_id = ${nextOffice}, status = ${nextStatus},
        updated_at = now(), updated_by = ${actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${locationId}
    RETURNING id, code, name, office_id, status, negative_stock_policy,
              created_at, updated_at
  `) as LocationRow[];

  return { outcome: "updated", location: mapLocation(rows[0]!), before };
}

export type NegativeStockPolicyView = {
  defaultNegativeStockPolicy: NegativeStockPolicy;
  /** `true` when the tenant never stored a value and the safe default applies. */
  isImplicitDefault: boolean;
};

export async function getTenantPolicy(
  tx: Bun.SQL,
  tenantId: string
): Promise<NegativeStockPolicyView> {
  const rows = (await tx`
    SELECT default_negative_stock_policy FROM awcms_inventory_settings
    WHERE tenant_id = ${tenantId}
  `) as { default_negative_stock_policy: NegativeStockPolicy }[];

  return {
    defaultNegativeStockPolicy:
      rows[0]?.default_negative_stock_policy ?? DEFAULT_NEGATIVE_STOCK_POLICY,
    isImplicitDefault: rows.length === 0
  };
}

export async function setTenantPolicy(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  policy: NegativeStockPolicy
): Promise<{ before: NegativeStockPolicy; after: NegativeStockPolicy }> {
  const before = await resolveTenantNegativeStockPolicy(tx, tenantId);

  await tx`
    INSERT INTO awcms_inventory_settings
      (tenant_id, default_negative_stock_policy, updated_by)
    VALUES (${tenantId}, ${policy}, ${actorTenantUserId})
    ON CONFLICT (tenant_id) DO UPDATE
      SET default_negative_stock_policy = EXCLUDED.default_negative_stock_policy,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
  `;

  return { before, after: policy };
}

export type SetLocationPolicyResult =
  | {
      outcome: "updated";
      location: StockLocation;
      before: NegativeStockPolicy | null;
    }
  | { outcome: "not_found" };

export async function setLocationPolicy(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string | null,
  locationId: string,
  policy: NegativeStockPolicy | null
): Promise<SetLocationPolicyResult> {
  const before = await getLocation(tx, tenantId, locationId);

  if (!before) {
    return { outcome: "not_found" };
  }

  const rows = (await tx`
    UPDATE awcms_inventory_locations
    SET negative_stock_policy = ${policy}, updated_at = now(),
        updated_by = ${actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${locationId}
    RETURNING id, code, name, office_id, status, negative_stock_policy,
              created_at, updated_at
  `) as LocationRow[];

  return {
    outcome: "updated",
    location: mapLocation(rows[0]!),
    before: before.negativeStockPolicy
  };
}
