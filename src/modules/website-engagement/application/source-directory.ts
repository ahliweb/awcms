/**
 * Website sources: create, read, change, rotate, revoke, delete (ADR-0155
 * sections 2, 3 and 8). Every function takes the caller's OWN tenant-scoped
 * transaction; none opens one.
 *
 * ## The token
 *
 * `createSource` and `rotateSource` return the token ONCE, in the result. Only
 * the keyed hash and the six-character prefix are stored, and no read function
 * in this file can return either the token or its hash: `SourceView` has no
 * such field.
 */
import { randomUUID } from "node:crypto";

import {
  keyedHashPrimary,
  type KeyRing
} from "../../../lib/security/field-encryption";
import {
  formatSourceToken,
  generateSourceSecret,
  sourceTokenPrefix
} from "../domain/source-token";
import type {
  CreateSourceInput,
  UpdateSourceInput
} from "../domain/source-validation";
import {
  SOURCE_TOKEN_HASH_PURPOSE,
  type ChallengeMode,
  type SourceStatus,
  type SubmissionKind
} from "../domain/website-engagement-constants";

type Sql = Bun.SQL;

export type SourceDomainView = {
  id: string;
  hostname: string;
  status: string;
};

export type SourceView = {
  id: string;
  code: string;
  name: string;
  status: SourceStatus;
  contractVersion: string;
  acceptedKinds: SubmissionKind[];
  consentCopyVersion: string;
  challengeMode: ChallengeMode;
  tokenPrefix: string;
  tokenRotatedAt: string;
  revokedAt: string | null;
  domains: SourceDomainView[];
  createdAt: string;
  updatedAt: string;
};

type SourceRow = {
  id: string;
  code: string;
  name: string;
  status: SourceStatus;
  contract_version: string;
  accepted_kinds: SubmissionKind[];
  consent_copy_version: string;
  challenge_mode: ChallengeMode;
  token_prefix: string;
  token_rotated_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toView(row: SourceRow, domains: SourceDomainView[]): SourceView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    contractVersion: row.contract_version,
    acceptedKinds: row.accepted_kinds,
    consentCopyVersion: row.consent_copy_version,
    challengeMode: row.challenge_mode,
    tokenPrefix: row.token_prefix,
    tokenRotatedAt: row.token_rotated_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    domains,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

async function loadDomains(
  tx: Sql,
  tenantId: string,
  sourceIds: string[]
): Promise<Map<string, SourceDomainView[]>> {
  const bySource = new Map<string, SourceDomainView[]>();

  if (sourceIds.length === 0) return bySource;

  const rows = (await tx`
    SELECT sd.source_id, d.id, d.hostname, d.status
    FROM awcms_engagement_source_domains sd
    JOIN awcms_tenant_domains d ON d.id = sd.tenant_domain_id
    WHERE sd.tenant_id = ${tenantId}
      AND sd.source_id = ANY(${tx.array(sourceIds, "uuid")})
    ORDER BY d.normalized_hostname
  `) as { source_id: string; id: string; hostname: string; status: string }[];

  for (const row of rows) {
    const list = bySource.get(row.source_id) ?? [];
    list.push({ id: row.id, hostname: row.hostname, status: row.status });
    bySource.set(row.source_id, list);
  }

  return bySource;
}

export async function listSources(
  tx: Sql,
  tenantId: string
): Promise<SourceView[]> {
  const rows = (await tx`
    SELECT id, code, name, status, contract_version, accepted_kinds,
           consent_copy_version, challenge_mode, token_prefix, token_rotated_at,
           revoked_at, created_at, updated_at
    FROM awcms_engagement_sources
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `) as SourceRow[];
  const domains = await loadDomains(
    tx,
    tenantId,
    rows.map((row) => row.id)
  );

  return rows.map((row) => toView(row, domains.get(row.id) ?? []));
}

export async function fetchSource(
  tx: Sql,
  tenantId: string,
  sourceId: string
): Promise<SourceView | null> {
  const rows = (await tx`
    SELECT id, code, name, status, contract_version, accepted_kinds,
           consent_copy_version, challenge_mode, token_prefix, token_rotated_at,
           revoked_at, created_at, updated_at
    FROM awcms_engagement_sources
    WHERE tenant_id = ${tenantId} AND id = ${sourceId} AND deleted_at IS NULL
  `) as SourceRow[];
  const row = rows[0];

  if (!row) return null;

  const domains = await loadDomains(tx, tenantId, [row.id]);

  return toView(row, domains.get(row.id) ?? []);
}

/** True when every id is a live (non-deleted) domain of THIS tenant. Another tenant's id is invisible under RLS and so counts as missing. */
async function domainsAreLive(
  tx: Sql,
  tenantId: string,
  domainIds: string[]
): Promise<boolean> {
  if (domainIds.length === 0) return true;

  const live = (await tx`
    SELECT id FROM awcms_tenant_domains
    WHERE tenant_id = ${tenantId}
      AND deleted_at IS NULL
      AND id = ANY(${tx.array(domainIds, "uuid")})
  `) as { id: string }[];

  return live.length === domainIds.length;
}

/** Replaces the source's host list. The caller has already checked `domainsAreLive`. */
async function replaceDomains(
  tx: Sql,
  tenantId: string,
  sourceId: string,
  actor: string,
  domainIds: string[]
): Promise<void> {
  await tx`
    DELETE FROM awcms_engagement_source_domains
    WHERE tenant_id = ${tenantId} AND source_id = ${sourceId}
  `;

  for (const domainId of domainIds) {
    await tx`
      INSERT INTO awcms_engagement_source_domains
        (tenant_id, source_id, tenant_domain_id, created_by)
      VALUES (${tenantId}, ${sourceId}, ${domainId}, ${actor})
    `;
  }
}

export type CreateSourceResult =
  | { outcome: "created"; source: SourceView; token: string }
  | { outcome: "code_taken" }
  | { outcome: "domain_not_found" };

export async function createSource(
  tx: Sql,
  tenantId: string,
  actor: string,
  input: CreateSourceInput,
  ring: KeyRing
): Promise<CreateSourceResult> {
  if (!(await domainsAreLive(tx, tenantId, input.domainIds))) {
    return { outcome: "domain_not_found" };
  }

  const sourceId = randomUUID();
  const secret = generateSourceSecret();
  const tokenHash = keyedHashPrimary(
    secret,
    { purpose: SOURCE_TOKEN_HASH_PURPOSE, tenantId },
    ring
  );

  const inserted = (await tx`
    INSERT INTO awcms_engagement_sources
      (id, tenant_id, code, name, consent_copy_version, challenge_mode,
       accepted_kinds, token_hash, token_prefix, created_by, updated_by)
    VALUES
      (${sourceId}, ${tenantId}, ${input.code}, ${input.name},
       ${input.consentCopyVersion}, ${input.challengeMode},
       ${tx.array(input.acceptedKinds, "text")}, ${tokenHash}, ${sourceTokenPrefix(secret)},
       ${actor}, ${actor})
    ON CONFLICT (tenant_id, code) WHERE deleted_at IS NULL DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (inserted.length === 0) return { outcome: "code_taken" };

  await replaceDomains(tx, tenantId, sourceId, actor, input.domainIds);

  const source = (await fetchSource(tx, tenantId, sourceId))!;

  return {
    outcome: "created",
    source,
    token: formatSourceToken(tenantId, sourceId, secret)
  };
}

export type UpdateSourceResult =
  | { outcome: "updated"; source: SourceView }
  | { outcome: "not_found" }
  | { outcome: "revoked" }
  | { outcome: "domain_not_found" };

export async function updateSource(
  tx: Sql,
  tenantId: string,
  actor: string,
  sourceId: string,
  patch: UpdateSourceInput
): Promise<UpdateSourceResult> {
  const current = await fetchSource(tx, tenantId, sourceId);

  if (!current) return { outcome: "not_found" };

  if (current.status === "revoked") return { outcome: "revoked" };

  if (patch.domainIds !== undefined) {
    if (!(await domainsAreLive(tx, tenantId, patch.domainIds))) {
      return { outcome: "domain_not_found" };
    }

    await replaceDomains(tx, tenantId, sourceId, actor, patch.domainIds);
  }

  await tx`
    UPDATE awcms_engagement_sources
    SET name = ${patch.name ?? current.name},
        consent_copy_version = ${patch.consentCopyVersion ?? current.consentCopyVersion},
        challenge_mode = ${patch.challengeMode ?? current.challengeMode},
        accepted_kinds = ${tx.array(patch.acceptedKinds ?? current.acceptedKinds, "text")},
        status = ${patch.status ?? current.status},
        updated_by = ${actor},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${sourceId} AND deleted_at IS NULL
  `;

  return {
    outcome: "updated",
    source: (await fetchSource(tx, tenantId, sourceId))!
  };
}

export type RotateSourceResult =
  | { outcome: "rotated"; source: SourceView; token: string }
  | { outcome: "not_found" }
  | { outcome: "revoked" };

/** The previous token stops working at once: there is deliberately no grace window. */
export async function rotateSource(
  tx: Sql,
  tenantId: string,
  actor: string,
  sourceId: string,
  ring: KeyRing
): Promise<RotateSourceResult> {
  const current = await fetchSource(tx, tenantId, sourceId);

  if (!current) return { outcome: "not_found" };

  if (current.status === "revoked") return { outcome: "revoked" };

  const secret = generateSourceSecret();

  await tx`
    UPDATE awcms_engagement_sources
    SET token_hash = ${keyedHashPrimary(
      secret,
      { purpose: SOURCE_TOKEN_HASH_PURPOSE, tenantId },
      ring
    )},
        token_prefix = ${sourceTokenPrefix(secret)},
        token_rotated_at = now(),
        updated_by = ${actor},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${sourceId} AND deleted_at IS NULL
  `;

  return {
    outcome: "rotated",
    source: (await fetchSource(tx, tenantId, sourceId))!,
    token: formatSourceToken(tenantId, sourceId, secret)
  };
}

export type RevokeSourceResult =
  | { outcome: "revoked"; source: SourceView; changed: boolean }
  | { outcome: "not_found" };

/** One-way, and idempotent: revoking a revoked source answers the same and changes nothing. */
export async function revokeSource(
  tx: Sql,
  tenantId: string,
  actor: string,
  sourceId: string
): Promise<RevokeSourceResult> {
  const current = await fetchSource(tx, tenantId, sourceId);

  if (!current) return { outcome: "not_found" };

  if (current.status === "revoked") {
    return { outcome: "revoked", source: current, changed: false };
  }

  await tx`
    UPDATE awcms_engagement_sources
    SET status = 'revoked', revoked_at = now(), updated_by = ${actor}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${sourceId} AND deleted_at IS NULL
  `;

  return {
    outcome: "revoked",
    source: (await fetchSource(tx, tenantId, sourceId))!,
    changed: true
  };
}

/** Soft delete: the row stays because submissions reference it; the source stops accepting at once. */
export async function deleteSource(
  tx: Sql,
  tenantId: string,
  actor: string,
  sourceId: string
): Promise<{ outcome: "deleted" | "not_found" }> {
  const rows = (await tx`
    UPDATE awcms_engagement_sources
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, now()),
        deleted_at = now(),
        deleted_by = ${actor},
        delete_reason = 'deleted_by_administrator',
        updated_by = ${actor},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${sourceId} AND deleted_at IS NULL
    RETURNING id
  `) as { id: string }[];

  return { outcome: rows.length > 0 ? "deleted" : "not_found" };
}
