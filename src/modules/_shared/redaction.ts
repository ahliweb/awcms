/**
 * Shared redaction (docs/awcms/10_template_kode_coding_standard.md §Logger
 * redaction). Used by both the structured logger and the DB audit trail so
 * the sensitive-key list is defined exactly once.
 */
const REDACTION_KEYS = [
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "secret",
  "credential",
  "authorization",
  "npwp",
  "nik",
  "phone",
  "whatsapp",
  "email",
  "cookie"
] as const;

// Exact-match only (not substring) — a substring match on "ip" would also
// mangle "description"/"shipping"/"recipient".
const EXACT_SENSITIVE_KEY_SYNONYMS = new Set([
  "ip",
  "ipaddress",
  "clientip",
  "remoteaddr",
  "remoteaddress",
  "xforwardedfor"
]);

const REDACTED_VALUE = "[REDACTED]";

function normalizeKeyForExactMatch(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();

  if (
    REDACTION_KEYS.some((redactionKey) => normalized.includes(redactionKey))
  ) {
    return true;
  }

  return EXACT_SENSITIVE_KEY_SYNONYMS.has(normalizeKeyForExactMatch(key));
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === "object") {
    return redactRecord(value as Record<string, unknown>);
  }

  return value;
}

function redactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    output[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactValue(value);
  }

  return output;
}

export function redactSensitiveAttributes(
  input: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (input === undefined) {
    return undefined;
  }

  return redactRecord(input);
}

function collectKeysDeep(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeysDeep(item, keys);
    }
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      keys.add(key);
      collectKeysDeep(nested, keys);
    }
  }
}

/**
 * Every secret-shaped KEY NAME anywhere in `input` (top-level or nested in
 * objects/arrays), by name — used to *reject* input containing a key like
 * `apiToken`/`credential` outright (module settings), rather than silently
 * redact-and-store it, since a value the app never persisted can't leak
 * later. `redactSensitiveAttributes` above stays the read-side/
 * defense-in-depth complement for values already at rest.
 */
export function findSensitiveKeys(
  input: Record<string, unknown> | undefined
): string[] {
  if (input === undefined) {
    return [];
  }

  const keys = new Set<string>();
  collectKeysDeep(input, keys);

  return [...keys].filter(isSensitiveKey);
}

/**
 * Value-shape complement to `findSensitiveKeys` (module settings): a
 * credential can still be written into an innocently-named field like
 * `publicLabel`, which key-name checking alone can't catch. Deliberately
 * conservative — only patterns that are essentially never a legitimate
 * label/URL/flag value — to keep false positives near zero: a JWT (three
 * base64url segments), a PEM private key block, an AWS access key id, a raw
 * `Bearer `/`Basic ` auth-header value, or a connection string with an
 * embedded `user:pass@` credential.
 *
 * This is a heuristic, not a DLP solution — it closes the
 * "innocent/accidental paste" gap the key-name check can't, not every
 * adversarial exfiltration path.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  // Third (signature) segment deliberately unbounded (`*`, not `{5,}`) — a
  // truncated/short-signature JWT still leaks its header/payload claims and
  // must still be flagged.
  /^eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]*$/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^AKIA[0-9A-Z]{16}$/,
  /^(Bearer|Basic)\s+\S+/i,
  // Password character class deliberately excludes only `/` and whitespace
  // (not `:`/`@`, which are common password characters); the greedy `+`
  // backtracks to the LAST `@` in the run, correctly separating "password"
  // from "host" when both appear inside the password itself.
  /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:@/\s]+:[^/\s]+@/
];

function isSecretShapedValue(value: unknown): boolean {
  return (
    typeof value === "string" &&
    SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function collectSecretShapedValuePaths(
  value: unknown,
  path: string,
  paths: string[]
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectSecretShapedValuePaths(item, `${path}[${index}]`, paths)
    );
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      collectSecretShapedValuePaths(
        nested,
        path ? `${path}.${key}` : key,
        paths
      );
    }
    return;
  }

  if (isSecretShapedValue(value)) {
    paths.push(path);
  }
}

/**
 * Every key path (dot notation, e.g. `webhook.publicLabel`, array indices as
 * `[n]`) whose string value looks like a credential, *regardless of the
 * key's own name*. Never includes the value itself, only the path, so a
 * rejection message stays safe to return to the client.
 */
export function findSecretShapedValues(
  input: Record<string, unknown> | undefined
): string[] {
  if (input === undefined) {
    return [];
  }

  const paths: string[] = [];
  collectSecretShapedValuePaths(input, "", paths);

  return paths;
}

const TEXT_SECRET_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  replacement: string;
}> = [
  {
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]"
  },
  {
    // Fallback for a TRUNCATED PEM block with no matching END marker (a log
    // line cut off by a buffer limit before the key finished): the paired
    // pattern above cannot match at all in that case, so the raw base64 key
    // body would pass through unredacted. MUST stay ordered after the paired
    // pattern — that one has already consumed every well-formed block, so
    // this only ever finds a genuinely unterminated one. Over-redacts any
    // trailing non-key text after a lone BEGIN marker, which is the safe
    // direction to err in.
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/g,
    replacement: "[REDACTED_PRIVATE_KEY]"
  },
  {
    pattern: /eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]*/g,
    replacement: "[REDACTED_JWT]"
  },
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: "[REDACTED_AWS_KEY]"
  },
  {
    pattern: /\b(Bearer|Basic)\s+\S+/gi,
    replacement: "$1 [REDACTED]"
  },
  {
    // Connection-string credentials (`DATABASE_URL`/`WORKER_DATABASE_URL` are
    // DSNs, so this is the app's own primary secret leaking through any DB
    // error text). Free-text twin of the anchored DSN entry in
    // `SECRET_VALUE_PATTERNS`. The password class excludes only `/` and
    // whitespace so that `:`/`@` inside a password still match; the greedy
    // `+` backtracks to the LAST `@`, which is what makes such passwords work.
    pattern: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^:@/\s]+:[^/\s]+@/g,
    replacement: "$1[REDACTED]@"
  },
  {
    pattern:
      /\b(password|passwordHash|token|accessToken|refreshToken|apiKey|secret|credential|authorization)\b(\s*[:=]\s*)(?!(?:Bearer|Basic)\b)("[^"]*"|'[^']*'|\S+)/gi,
    replacement: "$1$2[REDACTED]"
  }
];

/** Redacts secret-shaped substrings inside free text (an error message/stack), not just structured object keys. */
export function redactSecretsInText(text: string): string {
  let output = text;

  for (const { pattern, replacement } of TEXT_SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }

  return output;
}
