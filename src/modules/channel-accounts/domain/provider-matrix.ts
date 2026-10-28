/**
 * The provider capability matrix v1 — a CODE MIRROR of
 * `docs/awcms/omnichannel-foundation.md` section 3 (ADR-0148 section 3).
 *
 * `tests/channel-accounts-provider-matrix.test.ts` parses that table and holds
 * this file equal to it, cell by cell: a provider's capability cannot be widened
 * in code without the documentation (and its reviewers) seeing it, and the
 * documentation cannot be edited without this file following.
 *
 * ## How a cell is read (ADR-0148 section 3)
 *
 * - `candidate`  the provider documents it. Enabling it still needs a granted
 *                capability row WITH evidence on the account.
 * - `restricted` a contract or policy limits it. Denied unless the account's
 *                capability evidence is a written contract or authorisation.
 * - `not_offered` the official interface does not offer it. Always denied.
 * - `unverified` not yet verified against the official documentation. Treated as
 *                denied until the issue that implements the connector verifies it
 *                and bumps {@link PROVIDER_MATRIX_VERSION}.
 * - `not_applicable` the capability does not apply to this row. Always denied.
 * - `barred`     forbidden outright (LinkedIn member data into CRM, ADR-0148 I7).
 *                No configuration, evidence or contract reference unlocks it.
 *
 * A cell NEVER becomes usable because it reads `candidate`: the account needs a
 * `granted` capability row with evidence, and {@link evaluateCapability} is the
 * single place that decides.
 */
import type { ChannelAuthMode } from "./channel-accounts-constants";

export const PROVIDER_MATRIX_VERSION = 1;

export const CHANNEL_CAPABILITIES = [
  "publish",
  "reply",
  "dm",
  "inbound",
  "comments",
  "analytics",
  "leads",
  "ads",
  "broadcast"
] as const;

export type ChannelCapability = (typeof CHANNEL_CAPABILITIES)[number];

export type MatrixCell =
  | "candidate"
  | "restricted"
  | "not_offered"
  | "unverified"
  | "not_applicable"
  | "barred";

export type ProviderAccountKindRule = {
  /** Container identities (a WABA) hold no capability of their own; their children do. */
  container?: true;
  /** The kind the parent account must have. Absent: the account has no parent. */
  parentKind?: string;
};

export type ProviderMatrixRow = {
  /** The first column of the documentation table, verbatim (markdown included), so the equality test can match rows. */
  docLabel: string;
  /** `false` for rows that describe a policy boundary, not an account a tenant can register. */
  registrable: boolean;
  authModes: readonly ChannelAuthMode[];
  kinds: Readonly<Record<string, ProviderAccountKindRule>>;
  cells: Readonly<Record<ChannelCapability, MatrixCell>>;
};

const C = "candidate" as const;
const R = "restricted" as const;
const N = "not_offered" as const;
const U = "unverified" as const;
const A = "not_applicable" as const;
const B = "barred" as const;

function cells(
  publish: MatrixCell,
  reply: MatrixCell,
  dm: MatrixCell,
  inbound: MatrixCell,
  comments: MatrixCell,
  analytics: MatrixCell,
  leads: MatrixCell,
  ads: MatrixCell,
  broadcast: MatrixCell
): Readonly<Record<ChannelCapability, MatrixCell>> {
  return {
    publish,
    reply,
    dm,
    inbound,
    comments,
    analytics,
    leads,
    ads,
    broadcast
  };
}

export const PROVIDER_MATRIX: Readonly<Record<string, ProviderMatrixRow>> = {
  whatsapp_cloud: {
    docLabel: "WhatsApp Cloud API (Meta), WABA phone number",
    registrable: true,
    authModes: ["oauth2", "api_token"],
    kinds: {
      waba: { container: true },
      waba_phone_number: { parentKind: "waba" }
    },
    cells: cells(N, C, C, C, N, C, U, R, C)
  },
  starsender: {
    docLabel: "StarSender device (**unofficial**)",
    registrable: true,
    authModes: ["device_key"],
    kinds: { device: {} },
    cells: cells(N, C, C, U, N, N, N, N, R)
  },
  facebook: {
    docLabel: "Facebook Page",
    registrable: true,
    authModes: ["oauth2"],
    kinds: { page: {} },
    cells: cells(C, C, C, C, C, C, C, R, R)
  },
  instagram: {
    docLabel: "Instagram Professional",
    registrable: true,
    authModes: ["oauth2"],
    kinds: { professional_account: {} },
    cells: cells(C, C, C, C, C, C, U, R, N)
  },
  threads: {
    docLabel: "Threads profile",
    registrable: true,
    authModes: ["oauth2"],
    kinds: { profile: {} },
    cells: cells(C, C, N, U, C, C, N, N, N)
  },
  tiktok: {
    docLabel: "TikTok (Content Posting)",
    registrable: true,
    authModes: ["oauth2"],
    kinds: { creator_account: {} },
    cells: cells(C, N, N, U, U, U, N, R, N)
  },
  youtube: {
    docLabel: "YouTube channel",
    registrable: true,
    authModes: ["oauth2"],
    kinds: { channel: {} },
    cells: cells(C, C, N, U, C, C, N, R, N)
  },
  linkedin: {
    docLabel: "LinkedIn organisation Page (Community Management)",
    registrable: true,
    authModes: ["oauth2"],
    kinds: { organization_page: {} },
    cells: cells(C, C, N, U, C, C, R, R, N)
  },
  linkedin_member: {
    // A policy boundary, not an account kind: member data about people is barred
    // from CRM lead creation, enrichment and audience matching (ADR-0148 I7, section 8).
    docLabel: "LinkedIn **member** data",
    registrable: false,
    authModes: [],
    kinds: {},
    cells: cells(A, A, N, A, A, A, B, A, A)
  },
  telegram: {
    docLabel: "Telegram bot / channel (customer scope, #1155)",
    registrable: true,
    authModes: ["bot_token"],
    kinds: { bot: {}, channel: {} },
    cells: cells(C, C, C, C, U, N, N, N, R)
  },
  website: {
    // First-party forms are independent of C1 (ADR-0148 section 10, #1153): not a
    // connected external account, so nothing registers here.
    docLabel: "Website first-party forms and events (#1153)",
    registrable: false,
    authModes: [],
    kinds: {},
    cells: cells(A, A, A, C, A, A, C, A, A)
  },
  mailketing: {
    docLabel: "Email via Mailketing (#1158 to #1162)",
    registrable: true,
    authModes: ["api_token"],
    kinds: {
      esp_account: { container: true },
      sender_identity: { parentKind: "esp_account" }
    },
    cells: cells(N, N, C, R, N, U, N, N, C)
  }
};

export function getProviderRow(provider: string): ProviderMatrixRow | null {
  return Object.hasOwn(PROVIDER_MATRIX, provider)
    ? PROVIDER_MATRIX[provider]!
    : null;
}

/** The providers a tenant may register an account for. */
export function registrableProviders(): string[] {
  return Object.entries(PROVIDER_MATRIX)
    .filter(([, row]) => row.registrable)
    .map(([provider]) => provider);
}

export type AccountShapeVerdict =
  | { ok: true; container: boolean; parentKind: string | null }
  | {
      ok: false;
      code:
        | "PROVIDER_UNKNOWN"
        | "PROVIDER_NOT_REGISTRABLE"
        | "ACCOUNT_KIND_INVALID"
        | "AUTH_MODE_INVALID";
    };

/** Is `(provider, kind, authMode)` a combination the matrix admits? Unknown anything is refused, never defaulted. */
export function checkAccountShape(
  provider: string,
  accountKind: string,
  authMode: string
): AccountShapeVerdict {
  const row = getProviderRow(provider);

  if (!row) return { ok: false, code: "PROVIDER_UNKNOWN" };
  if (!row.registrable) return { ok: false, code: "PROVIDER_NOT_REGISTRABLE" };
  if (!Object.hasOwn(row.kinds, accountKind)) {
    return { ok: false, code: "ACCOUNT_KIND_INVALID" };
  }
  if (!(row.authModes as readonly string[]).includes(authMode)) {
    return { ok: false, code: "AUTH_MODE_INVALID" };
  }

  const kind = row.kinds[accountKind]!;

  return {
    ok: true,
    container: kind.container === true,
    parentKind: kind.parentKind ?? null
  };
}

export type CapabilityDenialCode =
  | "PROVIDER_UNKNOWN"
  | "ACCOUNT_KIND_CONTAINER"
  | "PROVIDER_NOT_OFFERED"
  | "PROVIDER_BARRED"
  | "PROVIDER_UNVERIFIED"
  | "PROVIDER_RESTRICTED"
  | "CAPABILITY_NOT_RECORDED"
  | "CAPABILITY_NOT_GRANTED"
  | "EVIDENCE_MISSING"
  | "MATRIX_VERSION_STALE"
  | "ACCOUNT_NOT_USABLE"
  | "CONNECTION_NOT_ACTIVE";

export type CapabilityVerdict =
  { allowed: true } | { allowed: false; code: CapabilityDenialCode };

/**
 * The matrix's own verdict for a cell, independent of any account: can this cell
 * EVER be granted, and with what kind of evidence? Used when a capability is
 * recorded (refuse early) and again by {@link evaluateCapability} (refuse on use).
 */
export function cellGrantability(
  provider: string,
  accountKind: string,
  capability: ChannelCapability
):
  | { grantable: true; requiresContractEvidence: boolean }
  | { grantable: false; code: CapabilityDenialCode } {
  const row = getProviderRow(provider);

  if (!row) return { grantable: false, code: "PROVIDER_UNKNOWN" };

  const kind = Object.hasOwn(row.kinds, accountKind)
    ? row.kinds[accountKind]!
    : null;

  // A container (a WABA) never performs an action itself.
  if (kind?.container) {
    return { grantable: false, code: "ACCOUNT_KIND_CONTAINER" };
  }

  const cell = row.cells[capability];

  switch (cell) {
    case "candidate":
      return { grantable: true, requiresContractEvidence: false };
    case "restricted":
      return { grantable: true, requiresContractEvidence: true };
    case "barred":
      return { grantable: false, code: "PROVIDER_BARRED" };
    case "unverified":
      return { grantable: false, code: "PROVIDER_UNVERIFIED" };
    case "not_offered":
    case "not_applicable":
      return { grantable: false, code: "PROVIDER_NOT_OFFERED" };
  }
}

export type CapabilityEvidenceKind =
  | "scope_list_hash"
  | "app_review_reference"
  | "contract_reference"
  | "written_authorization";

/** Evidence kinds that satisfy a `restricted` cell ("denied unless separately authorised in writing"). */
export const CONTRACT_EVIDENCE_KINDS: readonly CapabilityEvidenceKind[] = [
  "contract_reference",
  "written_authorization"
];

export type CapabilityRowFacts = {
  state: "granted" | "pending_approval" | "denied" | "not_offered";
  evidenceKind: CapabilityEvidenceKind | null;
  evidenceRef: string | null;
  matrixVersion: number;
};

export type AccountFacts = {
  provider: string;
  accountKind: string;
  status: string;
  /** `null` when the account has no connection (an API-token or device account). */
  connectionGrantState: string | null;
};

/**
 * THE capability decision (ADR-0148 I2). Fail-closed: every path that is not an
 * explicit, evidenced, current allow returns a denial, and a thrown error in a
 * caller must be treated as a denial too.
 *
 * Allowed only when ALL hold:
 *   1. the provider is in the matrix and the kind is not a container;
 *   2. the matrix cell is `candidate`, or `restricted` with contract evidence
 *      (`unverified`, `not_offered`, `not_applicable`, `barred` never);
 *   3. a capability row EXISTS (absence is denial), is `granted`, carries
 *      evidence, and was verified against the CURRENT matrix version;
 *   4. the account is `connected` (a pending, degraded, revoked, disabled or
 *      deleted account sends and publishes nothing);
 *   5. its connection, if any, has an `active` grant.
 */
export function evaluateCapability(input: {
  account: AccountFacts;
  capability: ChannelCapability;
  row: CapabilityRowFacts | null;
}): CapabilityVerdict {
  const { account, capability, row } = input;
  const grantability = cellGrantability(
    account.provider,
    account.accountKind,
    capability
  );

  if (!grantability.grantable) {
    return { allowed: false, code: grantability.code };
  }

  if (!row) return { allowed: false, code: "CAPABILITY_NOT_RECORDED" };
  if (row.state !== "granted") {
    return { allowed: false, code: "CAPABILITY_NOT_GRANTED" };
  }
  if (!row.evidenceKind || !row.evidenceRef) {
    return { allowed: false, code: "EVIDENCE_MISSING" };
  }
  if (
    grantability.requiresContractEvidence &&
    !CONTRACT_EVIDENCE_KINDS.includes(row.evidenceKind)
  ) {
    return { allowed: false, code: "PROVIDER_RESTRICTED" };
  }
  if (row.matrixVersion !== PROVIDER_MATRIX_VERSION) {
    return { allowed: false, code: "MATRIX_VERSION_STALE" };
  }
  if (account.status !== "connected") {
    return { allowed: false, code: "ACCOUNT_NOT_USABLE" };
  }
  if (
    account.connectionGrantState !== null &&
    account.connectionGrantState !== "active"
  ) {
    return { allowed: false, code: "CONNECTION_NOT_ACTIVE" };
  }

  return { allowed: true };
}
