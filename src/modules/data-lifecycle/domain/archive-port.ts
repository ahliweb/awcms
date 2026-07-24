/**
 * Provider-neutral archive port (ported from awcms-micro Issue #745, ADR-0037).
 * A "port" in the same sense ADR-0011 uses the word for CROSS-MODULE
 * capabilities, applied here to a cross-PROVIDER concern instead
 * (local/offline filesystem vs. a future external object-storage adapter) —
 * same shape as email/R2 provider abstractions elsewhere in this repo
 * (ADR-0006: provider optional, never a hard dependency of core operation).
 *
 * `local_offline` (`infrastructure/local-archive-adapter.ts`) is the DEFAULT
 * and the only adapter this port ships — required so archive/purge keeps
 * working on an offline/LAN deployment with no external object storage
 * configured at all (doc 15 offline-first rule). `external_object_storage` is
 * declared as a VALID `archive.port` value a descriptor can opt into
 * (forward-compatible typing) but has no concrete adapter yet — a natural
 * fast-follow once a real deployment needs it.
 */
export type ArchivePortKind = "local_offline" | "external_object_storage";

export type ArchiveWriteInput = {
  descriptorKey: string;
  tenantId: string;
  format: "jsonl" | "csv";
  schemaVersion: string;
  rows: readonly Record<string, unknown>[];
  cursorRangeStart: Date | null;
  cursorRangeEnd: Date | null;
};

export type ArchiveWriteResult = {
  /** A path/URI ONLY — never a credential ("archive and logs contain no credentials"). */
  artifactLocation: string;
  checksumHex: string;
  rowCount: number;
  restoreProcedureRef: string;
};

export type ArchivePort = {
  kind: ArchivePortKind;
  write(input: ArchiveWriteInput): Promise<ArchiveWriteResult>;
  /** Re-reads the artifact and recomputes its checksum, comparing against `expectedChecksumHex` — the "verified checksums" half of "Archive artifacts have deterministic manifests and verified checksums". */
  verify(
    artifactLocation: string,
    expectedChecksumHex: string
  ): Promise<boolean>;
  /**
   * Reads back the archived rows for reconciliation/restore testing.
   * Deliberately does NOT write anything back to the source table — restoring
   * data INTO a live table is a separate, manual, documented operator procedure
   * (`README.md` §Restore procedure), never an automated write this port
   * performs on its own (the same "no shared-table write" boundary ADR-0013 §6
   * establishes applies here too: only the OWNING module's own code writes its
   * own table, even during a restore).
   */
  read(artifactLocation: string): Promise<Record<string, unknown>[]>;
};
