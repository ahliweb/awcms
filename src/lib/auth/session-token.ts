import { createHash, randomBytes } from "node:crypto";

/** Opaque session tokens, not JWT — only the SHA-256 hash is ever persisted. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
