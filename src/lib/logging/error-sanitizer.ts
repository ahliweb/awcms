import { redactSecretsInText } from "../../modules/_shared/redaction";

/** Ensures a caught exception's message/stack is safe to log — never echoes a raw secret back via an error string. */
export function safeErrorDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  return redactSecretsInText(raw);
}
