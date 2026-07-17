import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  hashIdentifierValue,
  maskIdentifierValue,
  normalizeIdentifierValue
} from "../domain/identifier";
import type {
  AddIdentifierInput,
  ResolveProfileQuery
} from "../domain/identifier-validation";
import {
  toPartyMaskedAdminDTO,
  type PartyMaskedAdminDTO
} from "../domain/projection";
import { fetchPartyById } from "./party-directory";

export type ProfileIdentifierMaskedDTO = {
  id: string;
  profileId: string;
  identifierType: string;
  maskedValue: string;
  isPrimary: boolean;
  verificationStatus: string;
};

type IdentifierRow = {
  id: string;
  profile_id: string;
  identifier_type: string;
  masked_value: string;
  is_primary: boolean;
  verification_status: string;
};

function toIdentifierDTO(row: IdentifierRow): ProfileIdentifierMaskedDTO {
  return {
    id: row.id,
    profileId: row.profile_id,
    identifierType: row.identifier_type,
    maskedValue: row.masked_value,
    isPrimary: row.is_primary,
    verificationStatus: row.verification_status
  };
}

/**
 * Issue #150 — the partial unique index on
 * `awcms_profile_identifiers (tenant_id, identifier_type, value_hash)`
 * (`sql/003_awcms_central_profile_schema.sql`) is a caller-visible rule, not
 * an internal invariant: re-attaching an identifier that already exists is a
 * conflict the client can act on, so it must not surface as an unhandled
 * `PostgresError` (500).
 */
export class DuplicateIdentifierError extends Error {
  constructor() {
    super(
      "An identifier of this type with the same value already exists for this tenant."
    );
    this.name = "DuplicateIdentifierError";
  }
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

export async function addIdentifierToProfile(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  profileId: string,
  input: AddIdentifierInput,
  correlationId?: string
): Promise<ProfileIdentifierMaskedDTO | null> {
  const profile = await fetchPartyById(tx, tenantId, profileId);
  if (!profile) return null;

  const normalizedValue = normalizeIdentifierValue(
    input.identifierType,
    input.value
  );
  const valueHash = hashIdentifierValue(normalizedValue);
  const maskedValue = maskIdentifierValue(normalizedValue);

  let rows: IdentifierRow[];

  try {
    rows = (await tx`
      INSERT INTO awcms_profile_identifiers
        (tenant_id, profile_id, identifier_type, normalized_value, value_hash, masked_value, is_primary)
      VALUES (
        ${tenantId}, ${profileId}, ${input.identifierType}, ${normalizedValue}, ${valueHash},
        ${maskedValue}, ${input.isPrimary}
      )
      RETURNING id, profile_id, identifier_type, masked_value, is_primary, verification_status
    `) as IdentifierRow[];
  } catch (error) {
    if (
      error instanceof Bun.SQL.PostgresError &&
      String(error.errno) === POSTGRES_UNIQUE_VIOLATION
    ) {
      throw new DuplicateIdentifierError();
    }

    throw error;
  }

  const record = toIdentifierDTO(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: "profile_identity",
    action: "identifier_added",
    resourceType: "profile_identifier",
    resourceId: record.id,
    message: `Identifier attached to profile ${profileId}.`,
    attributes: { identifierType: input.identifierType },
    correlationId
  });

  return record;
}

export async function resolveProfileByIdentifier(
  tx: Bun.SQL,
  tenantId: string,
  query: ResolveProfileQuery
): Promise<PartyMaskedAdminDTO | null> {
  const normalizedValue = normalizeIdentifierValue(
    query.identifierType,
    query.value
  );
  const valueHash = hashIdentifierValue(normalizedValue);

  const identifierRows = await tx`
    SELECT profile_id FROM awcms_profile_identifiers
    WHERE tenant_id = ${tenantId} AND identifier_type = ${query.identifierType}
      AND value_hash = ${valueHash} AND deleted_at IS NULL
  `;
  const profileId = (identifierRows[0] as { profile_id: string } | undefined)
    ?.profile_id;

  if (!profileId) return null;

  const profile = await fetchPartyById(tx, tenantId, profileId);

  return profile ? toPartyMaskedAdminDTO(profile) : null;
}

export type ProfileEntityLinkDTO = {
  id: string;
  moduleKey: string;
  entityType: string;
  entityId: string;
  linkRole: string;
  createdAt: string;
};

export async function listProfileEntityLinks(
  tx: Bun.SQL,
  tenantId: string,
  profileId: string
): Promise<ProfileEntityLinkDTO[]> {
  const rows = (await tx`
    SELECT id, module_key, entity_type, entity_id, link_role, created_at
    FROM awcms_profile_entity_links
    WHERE tenant_id = ${tenantId} AND profile_id = ${profileId}
    ORDER BY created_at ASC
  `) as Array<{
    id: string;
    module_key: string;
    entity_type: string;
    entity_id: string;
    link_role: string;
    created_at: Date;
  }>;

  return rows.map((row) => ({
    id: row.id,
    moduleKey: row.module_key,
    entityType: row.entity_type,
    entityId: row.entity_id,
    linkRole: row.link_role,
    createdAt: row.created_at.toISOString()
  }));
}
