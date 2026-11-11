/**
 * Observability of the Issue #1262 key-ring transition (ADR-0137 section 2:
 * a key is dropped only when a read-only query over the stored key ids shows no
 * row left on it). Counts and key ids only; a key id is a short label, never key
 * material, and no value, hash or ciphertext leaves the database.
 *
 * Read by `security:readiness`, per tenant, inside that tenant's RLS context.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import {
  decryptFieldToString,
  hashesEqual,
  keyedHash,
  type KeyRing,
  type KeyRingKey
} from "../../../lib/security/field-encryption";
import { normalizeIdentifierValue } from "../../profile-identity/domain/identifier";
import {
  SUBMISSION_CONTACT_AAD_PURPOSE,
  SUBMISSION_EMAIL_HASH_PURPOSE
} from "../domain/website-engagement-constants";

/**
 * Per key id, whether ONE sample row proves the configured material is the
 * material that wrote it (#1269 audit M-1). A key id alone says nothing: `k1`
 * reused for a new key still "matches" by id while every old row stays shut.
 *
 *   contact          `ok` the sample ciphertext decrypts under the ring;
 *                    `unreadable` it does not (missing key, or same id with
 *                    other material).
 *   identifierHash   `ok` the sample email hash recomputes under the
 *                    configured key of that id; `mismatch` it does not;
 *                    `unknown_key` no configured key has that id. A token
 *                    hash cannot be recomputed (its secret is not stored), but
 *                    before #1262 tokens and identifiers shared one key, and
 *                    after it they share the hash ring, so the identifier
 *                    sample vouches for the token hashes under the same id.
 *
 * Results are labels only: no value, hash or plaintext leaves this function.
 */
export type KeyMaterialProbe = {
  contact: Record<string, "ok" | "unreadable">;
  identifierHash: Record<string, "ok" | "mismatch" | "unknown_key">;
};

function decryptsUnder(
  envelope: string,
  tenantId: string,
  rowId: string,
  ring: KeyRing | null
): string | null {
  if (!ring) return null;

  try {
    return decryptFieldToString(
      envelope,
      { purpose: SUBMISSION_CONTACT_AAD_PURPOSE, tenantId, rowId },
      ring
    );
  } catch {
    return null;
  }
}

export async function probeKeyMaterial(
  sql: Bun.SQL,
  tenantId: string,
  encryption: KeyRing | null,
  hashKeys: KeyRingKey[]
): Promise<KeyMaterialProbe> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const probe: KeyMaterialProbe = { contact: {}, identifierHash: {} };
      const contactSamples = (await tx`
        SELECT DISTINCT ON (key_id) key_id, id, contact_encrypted
        FROM (
          SELECT split_part(contact_encrypted, ':', 2) AS key_id, id,
                 contact_encrypted, received_at
          FROM awcms_engagement_submissions
          WHERE tenant_id = ${tenantId} AND contact_encrypted IS NOT NULL
        ) s
        ORDER BY key_id, received_at DESC, id
      `) as { key_id: string; id: string; contact_encrypted: string }[];

      for (const sample of contactSamples) {
        probe.contact[sample.key_id] =
          decryptsUnder(
            sample.contact_encrypted,
            tenantId,
            sample.id,
            encryption
          ) === null
            ? "unreadable"
            : "ok";
      }

      const hashSamples = (await tx`
        SELECT DISTINCT ON (key_id) key_id, id, contact_encrypted, email_hash
        FROM (
          SELECT split_part(email_hash, ':', 1) AS key_id, id,
                 contact_encrypted, email_hash, received_at
          FROM awcms_engagement_submissions
          WHERE tenant_id = ${tenantId}
            AND email_hash IS NOT NULL
            AND contact_encrypted IS NOT NULL
        ) s
        ORDER BY key_id, received_at DESC, id
      `) as {
        key_id: string;
        id: string;
        contact_encrypted: string;
        email_hash: string;
      }[];

      for (const sample of hashSamples) {
        const key = hashKeys.find(
          (candidate) => candidate.id === sample.key_id
        );

        if (!key) {
          probe.identifierHash[sample.key_id] = "unknown_key";
          continue;
        }

        const plain = decryptsUnder(
          sample.contact_encrypted,
          tenantId,
          sample.id,
          encryption
        );
        let email: unknown = null;

        try {
          email = plain === null ? null : JSON.parse(plain)?.email;
        } catch {
          email = null;
        }

        // Unverifiable without the plaintext; the contact probe reports that.
        if (typeof email !== "string") continue;

        const recomputed = keyedHash(
          normalizeIdentifierValue("email", email),
          { purpose: SUBMISSION_EMAIL_HASH_PURPOSE, tenantId },
          key
        );

        probe.identifierHash[sample.key_id] = hashesEqual(
          recomputed,
          sample.email_hash
        )
          ? "ok"
          : "mismatch";
      }

      return probe;
    },
    { workClass: "maintenance" }
  );
}

/**
 * Live source tokens per hash key id. A revoked or deleted source can never be
 * accepted again, so its stored hash keeps no key alive and is not counted.
 */
export async function countSourceTokensByKeyId(
  sql: Bun.SQL,
  tenantId: string
): Promise<Record<string, number>> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT CASE WHEN token_hash ~ '^[a-z0-9]{1,8}:' THEN split_part(token_hash, ':', 1) ELSE '?' END AS key_id,
               count(*)::int AS rows
        FROM awcms_engagement_sources
        WHERE tenant_id = ${tenantId}
          AND status <> 'revoked'
          AND deleted_at IS NULL
        GROUP BY 1
      `) as { key_id: string; rows: number }[];

      return Object.fromEntries(rows.map((row) => [row.key_id, row.rows]));
    },
    { workClass: "maintenance" }
  );
}

/** Stored contact ciphertexts per encryption key id (a withdrawn row has none). */
export async function countSubmissionContactsByKeyId(
  sql: Bun.SQL,
  tenantId: string
): Promise<Record<string, number>> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT CASE WHEN contact_encrypted ~ '^v2:[a-z0-9]{1,8}:' THEN split_part(contact_encrypted, ':', 2) ELSE '?' END AS key_id,
               count(*)::int AS rows
        FROM awcms_engagement_submissions
        WHERE tenant_id = ${tenantId}
          AND contact_encrypted IS NOT NULL
        GROUP BY 1
      `) as { key_id: string; rows: number }[];

      return Object.fromEntries(rows.map((row) => [row.key_id, row.rows]));
    },
    { workClass: "maintenance" }
  );
}
