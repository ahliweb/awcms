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
    pattern: /eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]*/g,
    replacement: "[REDACTED_JWT]"
  },
  {
    pattern: /\b(Bearer|Basic)\s+\S+/gi,
    replacement: "$1 [REDACTED]"
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
