/**
 * Server registration + enrollment challenge domain logic, Issue
 * ahliweb/omes#198.
 *
 * `validateServerRegistrationInput` mirrors the `server` sub-object of the
 * OMES-owned `contracts/control-center/v1/server-registration.request.schema.json`
 * fixture byte-for-byte (hostname pattern, `platform.os`/`.arch` enums) — the
 * same "never invent, never widen without updating the contract fixture"
 * discipline `domain/operations.ts` documents for the safe-operation enum.
 */
import { createHash, randomBytes } from "node:crypto";

const HOSTNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,253}$/;
const OS_VALUES = ["ubuntu", "linuxmint"] as const;
const ARCH_VALUES = ["amd64", "arm64"] as const;

export type ServerPlatform = {
  os: (typeof OS_VALUES)[number];
  version: string;
  arch: (typeof ARCH_VALUES)[number];
};

export type ServerRegistrationInput = {
  hostname: string;
  platform: ServerPlatform;
  ip?: string;
  tags?: unknown[];
};

export type ServerRegistrationValidation =
  | { valid: true; value: ServerRegistrationInput }
  | { valid: false; errors: { field: string; message: string }[] };

export function validateServerRegistrationInput(
  body: unknown
): ServerRegistrationValidation {
  const errors: { field: string; message: string }[] = [];

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Request body must be a JSON object." }]
    };
  }

  const record = body as Record<string, unknown>;

  if (
    typeof record.hostname !== "string" ||
    !HOSTNAME_PATTERN.test(record.hostname)
  ) {
    errors.push({
      field: "hostname",
      message: "hostname is required and must match ^[A-Za-z0-9][A-Za-z0-9.-]{0,253}$."
    });
  }

  let platform: ServerPlatform | undefined;
  if (typeof record.platform !== "object" || record.platform === null) {
    errors.push({ field: "platform", message: "platform is required." });
  } else {
    const platformRecord = record.platform as Record<string, unknown>;
    const os = platformRecord.os;
    const version = platformRecord.version;
    const arch = platformRecord.arch;

    if (typeof os !== "string" || !OS_VALUES.includes(os as (typeof OS_VALUES)[number])) {
      errors.push({
        field: "platform.os",
        message: `platform.os must be one of: ${OS_VALUES.join(", ")}.`
      });
    }

    if (typeof version !== "string" || version.length === 0) {
      errors.push({ field: "platform.version", message: "platform.version is required." });
    }

    if (
      typeof arch !== "string" ||
      !ARCH_VALUES.includes(arch as (typeof ARCH_VALUES)[number])
    ) {
      errors.push({
        field: "platform.arch",
        message: `platform.arch must be one of: ${ARCH_VALUES.join(", ")}.`
      });
    }

    if (
      typeof os === "string" &&
      OS_VALUES.includes(os as (typeof OS_VALUES)[number]) &&
      typeof version === "string" &&
      version.length > 0 &&
      typeof arch === "string" &&
      ARCH_VALUES.includes(arch as (typeof ARCH_VALUES)[number])
    ) {
      platform = { os: os as ServerPlatform["os"], version, arch: arch as ServerPlatform["arch"] };
    }
  }

  if (record.ip !== undefined && typeof record.ip !== "string") {
    errors.push({ field: "ip", message: "ip must be a string when present." });
  }

  if (record.tags !== undefined && !Array.isArray(record.tags)) {
    errors.push({ field: "tags", message: "tags must be an array when present." });
  }

  if (errors.length > 0 || !platform) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      hostname: record.hostname as string,
      platform,
      ip: typeof record.ip === "string" ? record.ip : undefined,
      tags: Array.isArray(record.tags) ? record.tags : undefined
    }
  };
}

/** An issued-but-unused enrollment challenge is refused past this window. */
export const ENROLLMENT_CHALLENGE_TTL_MS = 15 * 60 * 1000;

export type EnrollmentChallenge = {
  /** Returned to the caller ONCE and never persisted — see sql/157's header. */
  rawChallenge: string;
  /** What is actually stored, per the same discipline as session/API-key hashing. */
  challengeHash: string;
  /** Opaque worker identity minted at challenge time (`awcms_omes_enrollments.worker_id`). */
  workerId: string;
  expiresAt: Date;
};

function toBase64Url(input: Buffer): string {
  return input.toString("base64url");
}

/**
 * Mints a fresh challenge. High-entropy (32 bytes -> 43 base64url chars),
 * matching `worker-enrollment.request.schema.json`'s
 * `enrollment_challenge` pattern (`^[A-Za-z0-9_.:-]{16,256}$`) — base64url's
 * alphabet is a subset of that pattern's character class.
 */
export function issueEnrollmentChallenge(now: Date): EnrollmentChallenge {
  const rawChallenge = toBase64Url(randomBytes(32));
  const workerId = `worker_${toBase64Url(randomBytes(16))}`;

  return {
    rawChallenge,
    challengeHash: hashEnrollmentChallenge(rawChallenge),
    workerId,
    expiresAt: new Date(now.getTime() + ENROLLMENT_CHALLENGE_TTL_MS)
  };
}

export function hashEnrollmentChallenge(rawChallenge: string): string {
  return createHash("sha256").update(rawChallenge).digest("hex");
}
