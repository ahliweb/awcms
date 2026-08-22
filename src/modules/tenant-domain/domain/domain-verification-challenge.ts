/**
 * The DNS TXT ownership challenge for a tenant domain (ADR-0106). Pure — no
 * I/O, no database, no resolver.
 *
 * ## Why every part of the challenge is minted here and never accepted
 *
 * Before ADR-0106 the API accepted `verificationRecordName` and
 * `verificationRecordValue` from the caller, and `POST .../verify` compared
 * them against nothing at all. Making the comparison real is only half a fix:
 * a check against a caller-chosen name AND a caller-chosen value proves
 * nothing, because the caller can point both at a record that already exists.
 * `example.com` publishes plenty of TXT records; an attacker who may choose
 * `hostname = example.com`, `recordName = example.com` and
 * `recordValue = "v=spf1 -all"` would pass an otherwise perfectly good DNS
 * lookup without controlling one byte of that zone.
 *
 * So both halves are server-owned and neither is settable through the API:
 *
 *  - The NAME is derived from the hostname being claimed
 *    (`_awcms-verify.<host>`), so the record can only live in the zone that is
 *    actually being claimed. An underscore-prefixed label is used for the same
 *    reason every other verification scheme uses one: it cannot collide with a
 *    real host, and publishing it is not a thing a zone does by accident.
 *  - The VALUE is 32 random bytes minted per domain row. Unguessable, so
 *    "this record exists" and "we put this record there" are the same
 *    statement.
 *
 * ## What this proves, and what it does not
 *
 * It proves that whoever asked for the domain can publish a record in that
 * domain's zone. That is the standard bar for domain-control validation and it
 * is the bar this repo needs: `resolvePublicTenantByHost` maps an inbound
 * `Host` to a tenant, so the question is exactly "may this tenant answer for
 * this hostname". It does NOT prove legal ownership, and it is not a
 * certificate — TLS is somebody else's problem.
 *
 * The challenge is not a secret. It is handed back through the API so the
 * tenant can publish it, and anyone who can read the zone can read it. Its
 * security property is unguessability BEFORE publication, not confidentiality
 * after — which is why it is stored in `verification_record_value` (a public
 * column) and not in `verification_token_hash` (which no code in this module
 * writes; see the directory's header).
 */

/**
 * The label the challenge record lives under. Underscore-prefixed so it can
 * never collide with a real host, and so `normalizePublicHost()` — which
 * rightly rejects underscores in a `Host` header — is never asked to accept
 * one. See `cloudflare-dns-adapter.ts`'s `isValidDnsRecordNameShape` for the
 * same distinction drawn for the same reason.
 */
export const VERIFICATION_RECORD_LABEL = "_awcms-verify";

/**
 * Prefix on the record's VALUE. Not a security property — it is there so an
 * operator reading a zone file can tell what the record is for, and so a
 * record belonging to some other product is never mistaken for one of ours
 * even in the impossible case that the random half collides.
 */
export const VERIFICATION_VALUE_PREFIX = "awcms-site-verification=";

/** 32 bytes, base64url — 256 bits, no padding, DNS-safe characters only. */
const VERIFICATION_TOKEN_BYTES = 32;

/**
 * RFC 1035 §2.3.4: 255 octets of wire format, which is 253 characters of
 * presentation form. A hostname long enough to push the prefixed name past it
 * cannot be verified, and saying so is better than emitting a name no resolver
 * will answer for.
 */
const MAX_DNS_NAME_LENGTH = 253;

/**
 * A generous bound on how many TXT records are examined at one name. A zone
 * can publish many; a resolver response that carries thousands is either
 * pathological or hostile, and neither is a reason to spend the request's time
 * on it. Far above any real zone's count for a single underscore label — which
 * in practice is one, the one we asked for.
 */
export const MAX_TXT_RECORDS_SCANNED = 50;

export type VerificationChallenge = {
  /** Fully-qualified name to publish the record at. */
  recordName: string;
  /** Exact TXT value that must appear at `recordName`. */
  recordValue: string;
};

export type BuildRecordNameResult =
  { ok: true; recordName: string } | { ok: false; reason: "hostname_too_long" };

/**
 * `_awcms-verify.<normalizedHostname>`.
 *
 * Takes the NORMALIZED hostname (the column the resolver matches against),
 * never the raw one, so the name that gets queried is the name that would get
 * served. The caller has already put the value through `normalizePublicHost`,
 * which is what makes this safe to concatenate: a hostname that reached this
 * function has RFC 1035 shape and cannot contain a character that would change
 * what is being asked for.
 */
export function buildVerificationRecordName(
  normalizedHostname: string
): BuildRecordNameResult {
  const recordName = `${VERIFICATION_RECORD_LABEL}.${normalizedHostname}`;

  if (recordName.length > MAX_DNS_NAME_LENGTH) {
    return { ok: false, reason: "hostname_too_long" };
  }

  return { ok: true, recordName };
}

/**
 * A fresh challenge value. `crypto.getRandomValues` rather than `Math.random`
 * for the obvious reason, and a new one per domain row rather than per tenant
 * so that publishing one zone's record never activates a second hostname.
 */
export function mintVerificationRecordValue(): string {
  const bytes = new Uint8Array(VERIFICATION_TOKEN_BYTES);
  crypto.getRandomValues(bytes);

  return `${VERIFICATION_VALUE_PREFIX}${Buffer.from(bytes).toString("base64url")}`;
}

export type MintChallengeResult =
  | { ok: true; challenge: VerificationChallenge }
  | { ok: false; reason: "hostname_too_long" };

export function mintVerificationChallenge(
  normalizedHostname: string
): MintChallengeResult {
  const name = buildVerificationRecordName(normalizedHostname);

  if (!name.ok) {
    return { ok: false, reason: name.reason };
  }

  return {
    ok: true,
    challenge: {
      recordName: name.recordName,
      recordValue: mintVerificationRecordValue()
    }
  };
}

/**
 * Does any TXT record at the queried name carry the expected value?
 *
 * `records` is the resolver's own shape: one entry per TXT record, each a list
 * of the character-strings that record was split into. RFC 1035 caps a single
 * character-string at 255 octets, so a value longer than that arrives as
 * several chunks and is CONCATENATED with no separator — joining with a space
 * (or reading only `chunks[0]`) is the classic way this comparison silently
 * stops matching for long values. Ours is 67 characters and would never be
 * split, but a comparison that only works because the value is short is a
 * comparison that breaks the day the value changes.
 *
 * Each candidate is trimmed before comparison and the expected value is not:
 * every provider's zone editor treats surrounding whitespace differently, and
 * a leading space in a pasted record is an operator's typo rather than a
 * different claim. Nothing else is normalised — no case folding (the value is
 * base64url, where case is meaning) and no quote stripping (the resolver has
 * already removed the presentation-form quotes).
 */
export function txtRecordsCarryValue(
  records: readonly (readonly string[])[],
  expectedValue: string
): boolean {
  const scanned = records.slice(0, MAX_TXT_RECORDS_SCANNED);

  return scanned.some((chunks) => chunks.join("").trim() === expectedValue);
}
