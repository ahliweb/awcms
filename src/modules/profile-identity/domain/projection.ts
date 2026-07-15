/**
 * Allow-list projection (never a blocklist) — the admin API only ever
 * returns this shape, never the raw table row: `tenantId` (caller already
 * knows it from request context) and raw `deletedBy`/`restoredBy` actor ids
 * (audit-trail detail, available via `GET /api/v1/logs/audit`) are
 * deliberately excluded.
 */
export type PartyRecordForProjection = {
  id: string;
  tenantId: string;
  profileType: string;
  displayName: string;
  legalName: string | null;
  status: string;
  verificationStatus: string;
  riskLevel: string;
  mergedIntoProfileId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
  restoredAt: Date | null;
  restoredBy: string | null;
};

export type PartyMaskedAdminDTO = {
  id: string;
  profileType: string;
  displayName: string;
  legalName: string | null;
  status: string;
  verificationStatus: string;
  riskLevel: string;
  mergedIntoProfileId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deleteReason: string | null;
  restoredAt: string | null;
};

export function toPartyMaskedAdminDTO(
  record: PartyRecordForProjection
): PartyMaskedAdminDTO {
  return {
    id: record.id,
    profileType: record.profileType,
    displayName: record.displayName,
    legalName: record.legalName,
    status: record.status,
    verificationStatus: record.verificationStatus,
    riskLevel: record.riskLevel,
    mergedIntoProfileId: record.mergedIntoProfileId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
    deleteReason: record.deleteReason,
    restoredAt: record.restoredAt ? record.restoredAt.toISOString() : null
  };
}
