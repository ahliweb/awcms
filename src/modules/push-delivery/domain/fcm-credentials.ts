/**
 * FCM service-account credential parsing (Issue #466, ADR-0074). Pure — no
 * `process.env` reads, no network, no crypto. Given a string, it either yields
 * a validated credential or a reason it is not one.
 *
 * ## Why the value arrives base64
 *
 * A Google service-account credential is a JSON document whose `private_key`
 * is a PEM block — multi-line by nature. `scripts/validate-env.ts` parses
 * `.env` LINE BY LINE with its own parser, so a multi-line value is silently
 * truncated at the first newline: the variable would appear to be set, the JSON
 * would fail to parse, and the failure would surface at the first send rather
 * than at boot.
 *
 * So `PUSH_FCM_CREDENTIALS_BASE64` carries base64 of the whole JSON — one line,
 * no escaping, and the same shape `AUTH_MFA_SECRET_ENCRYPTION_KEY` already
 * establishes for binary key material.
 *
 * ## Why parsing is separated from using
 *
 * Everything here is a pure function over a string, which is what lets
 * `config:validate` reject a malformed credential at BOOT with the same code
 * path the adapter uses at send time. A validator that re-implemented the
 * checks would be free to disagree with the thing it validates, and would, in
 * exactly the case nobody tests.
 */

/** Only the fields this adapter needs. A real credential carries more; extra keys are ignored, not rejected. */
export type FcmServiceAccount = {
  projectId: string;
  clientEmail: string;
  /** PEM, PKCS#8 (`-----BEGIN PRIVATE KEY-----`). Never logged, never included in an error. */
  privateKeyPem: string;
  /** Google's OAuth2 token endpoint, taken from the credential rather than hardcoded — the credential is what names it. */
  tokenUri: string;
};

export type FcmCredentialParseResult =
  { ok: true; credential: FcmServiceAccount } | { ok: false; reason: string };

const REQUIRED_FIELDS = [
  "project_id",
  "client_email",
  "private_key",
  "token_uri"
] as const;

/**
 * PKCS#8 only. Google issues PKCS#8 (`BEGIN PRIVATE KEY`); the older PKCS#1
 * form (`BEGIN RSA PRIVATE KEY`) is rejected HERE with a message that names the
 * difference, because `crypto.subtle.importKey("pkcs8", …)` would otherwise
 * fail at the first send with an opaque `DataError`.
 */
const PKCS8_HEADER = "-----BEGIN PRIVATE KEY-----";
const PKCS1_HEADER = "-----BEGIN RSA PRIVATE KEY-----";

export function parseFcmCredentialsBase64(
  raw: string
): FcmCredentialParseResult {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { ok: false, reason: "credential is empty" };
  }

  let json: string;

  try {
    json = Buffer.from(trimmed, "base64").toString("utf8");
  } catch {
    return { ok: false, reason: "credential is not valid base64" };
  }

  // `Buffer.from(…, "base64")` never throws on garbage — it decodes what it can
  // and drops the rest. So "did it decode" is not a real check; "did it decode
  // to something parseable" is.
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      ok: false,
      reason:
        "credential does not base64-decode to JSON (a raw, un-encoded service-account file is the usual cause)"
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "credential JSON is not an object" };
  }

  const record = parsed as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter(
    (field) => typeof record[field] !== "string" || record[field] === ""
  );

  if (missing.length > 0) {
    // Field NAMES only. The value of `private_key` must never reach a log line,
    // an error message, or a validation report.
    return {
      ok: false,
      reason: `credential JSON is missing field(s): ${missing.join(", ")}`
    };
  }

  const privateKeyPem = record.private_key as string;

  if (privateKeyPem.includes(PKCS1_HEADER)) {
    return {
      ok: false,
      reason:
        "private_key is PKCS#1 (`BEGIN RSA PRIVATE KEY`); this adapter needs PKCS#8 (`BEGIN PRIVATE KEY`), which is what Google issues"
    };
  }

  if (!privateKeyPem.includes(PKCS8_HEADER)) {
    return {
      ok: false,
      reason: "private_key is not a PKCS#8 PEM block"
    };
  }

  const tokenUri = record.token_uri as string;

  if (!tokenUri.startsWith("https://")) {
    // A credential naming an http:// token endpoint would send a signed
    // assertion — a bearer grant — in the clear.
    return { ok: false, reason: "token_uri must be https" };
  }

  return {
    ok: true,
    credential: {
      projectId: record.project_id as string,
      clientEmail: record.client_email as string,
      privateKeyPem,
      tokenUri
    }
  };
}

/** `https://fcm.googleapis.com/v1/projects/{projectId}/messages:send` — built from the credential, never from configuration, so the two cannot disagree about which project is being addressed. */
export function buildFcmSendUrl(credential: FcmServiceAccount): string {
  return `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credential.projectId)}/messages:send`;
}

/** The single OAuth2 scope this adapter needs. Narrower than `cloud-platform`, which would grant the whole project. */
export const FCM_OAUTH_SCOPE =
  "https://www.googleapis.com/auth/firebase.messaging";
