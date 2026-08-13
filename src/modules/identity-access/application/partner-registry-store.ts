import type { RegisterPartnerInput } from "../domain/partner-registration";

/**
 * The ONLY writer of `awcms_partners` (ADR-0089). Reads and writes live here
 * rather than in the route because `modules:table-writes:check` resolves table
 * ownership from the file a write appears in, and a page or a second module
 * writing this table would register as a second owner.
 *
 * Every function takes the acting tenant as `platformTenantId` and means it:
 * the chokepoint has already refused the request unless the acting tenant IS
 * the platform tenant (ADR-0053), so there is no second resolution here and no
 * opportunity for the two to disagree.
 */

export type PartnerSummary = {
  id: string;
  partnerTenantId: string;
  partnerCode: string;
  displayName: string;
  status: string;
  registeredAt: Date;
  /**
   * From `awcms_tenants`, not denormalised. Reading the partner's own code and
   * name through the join is what `partner-engagement-store.ts` already does
   * for the customer side, and it keeps `awcms_partners` from becoming a second
   * place a tenant's name is stored and can go stale.
   */
  tenantCode: string;
  tenantName: string;
};

type PartnerRow = {
  id: string;
  partner_tenant_id: string;
  partner_code: string;
  display_name: string;
  status: string;
  registered_at: Date;
  tenant_code: string;
  tenant_name: string;
};

function toSummary(row: PartnerRow): PartnerSummary {
  return {
    id: row.id,
    partnerTenantId: row.partner_tenant_id,
    partnerCode: row.partner_code,
    displayName: row.display_name,
    status: row.status,
    registeredAt: row.registered_at,
    tenantCode: row.tenant_code,
    tenantName: row.tenant_name
  };
}

/**
 * The registry, newest first.
 *
 * Two independent things keep this from being the cross-tenant directory
 * ADR-0089 refused: RLS (every row carries the platform tenant's `tenant_id`,
 * so no other tenant's session can see one) and the platform gate at the
 * chokepoint. Removing either — a `SECURITY DEFINER` helper for a "partner
 * picker", a view without RLS — rebuilds the artefact that was rejected.
 */
export async function listPartners(
  tx: Bun.SQL,
  platformTenantId: string
): Promise<PartnerSummary[]> {
  const rows = (await tx`
    SELECT p.id, p.partner_tenant_id, p.partner_code, p.display_name,
           p.status, p.registered_at, t.tenant_code, t.tenant_name
    FROM awcms_partners p
    JOIN awcms_tenants t ON t.id = p.partner_tenant_id
    WHERE p.tenant_id = ${platformTenantId}
    ORDER BY p.created_at DESC
    LIMIT 200
  `) as PartnerRow[];

  return rows.map(toSummary);
}

export type RegisterPartnerResult =
  | { outcome: "registered"; partner: PartnerSummary }
  | { outcome: "tenant_not_found" }
  | { outcome: "self" }
  | { outcome: "already_registered" }
  | { outcome: "code_taken" };

/**
 * Registers an EXISTING tenant as a partner.
 *
 * It creates nothing but a row. A partner is an ordinary tenant (ADR-0089) —
 * this does not provision one, does not grant it anything, and is never read by
 * `activeRoleGrants`. The row is a PRECONDITION for a customer to engage this
 * partner, not a conferral of authority, and teaching authorization to read it
 * would recreate the second grant path ADR-0079 removed.
 */
export async function registerPartner(
  tx: Bun.SQL,
  platformTenantId: string,
  input: RegisterPartnerInput
): Promise<RegisterPartnerResult> {
  // Refused here as well as by `awcms_partners_not_self_check`, because a 23514
  // is a stack trace where the honest answer is a sentence. The CHECK stays the
  // thing that actually enforces it.
  if (input.partnerTenantId === platformTenantId) return { outcome: "self" };

  // `awcms_tenants` is the RLS-free root table, so this read is possible — and
  // the caller is the platform, which already lists every tenant through
  // `tenant_provisioning.read`. Checked explicitly so a missing tenant answers
  // "no such tenant" rather than a raw 23503 from the foreign key.
  const tenantRows = (await tx`
    SELECT id FROM awcms_tenants WHERE id = ${input.partnerTenantId}
  `) as { id: string }[];

  if (!tenantRows[0]) return { outcome: "tenant_not_found" };

  // `ON CONFLICT DO NOTHING` covers BOTH global unique indexes at once
  // (`partner_tenant_id` and `partner_code`). Letting them raise instead would
  // mean telling the two 23505s apart from a driver whose `code` is its own
  // constant rather than the SQLSTATE — the trap this repo has already paid
  // for. A conflict here leaves the transaction usable, so the disambiguating
  // read below can run and the 409 can say WHICH key was taken.
  const inserted = (await tx`
    INSERT INTO awcms_partners
      (tenant_id, partner_tenant_id, partner_code, display_name)
    VALUES (
      ${platformTenantId}, ${input.partnerTenantId},
      ${input.partnerCode}, ${input.displayName}
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (!inserted[0]) {
    const clash = (await tx`
      SELECT bool_or(partner_tenant_id = ${input.partnerTenantId}) AS tenant_taken
      FROM awcms_partners
      WHERE partner_tenant_id = ${input.partnerTenantId}
         OR partner_code = ${input.partnerCode}
    `) as { tenant_taken: boolean | null }[];

    return clash[0]?.tenant_taken
      ? { outcome: "already_registered" }
      : { outcome: "code_taken" };
  }

  // Re-read through `listPartners`' shape rather than RETURNING the row: the
  // summary carries the partner tenant's code and name, which the INSERT has no
  // way to produce, and two spellings of one projection is how they diverge.
  const rows = (await tx`
    SELECT p.id, p.partner_tenant_id, p.partner_code, p.display_name,
           p.status, p.registered_at, t.tenant_code, t.tenant_name
    FROM awcms_partners p
    JOIN awcms_tenants t ON t.id = p.partner_tenant_id
    WHERE p.tenant_id = ${platformTenantId} AND p.id = ${inserted[0].id}
  `) as PartnerRow[];

  const row = rows[0];

  if (!row) throw new Error("Partner insert returned no readable row.");

  return { outcome: "registered", partner: toSummary(row) };
}
