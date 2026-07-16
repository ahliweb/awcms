import { createHmac, timingSafeEqual } from "node:crypto";

export function computeSyncSignature(
  secret: string,
  timestamp: string,
  body: string
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function verifySyncSignature(
  secret: string,
  timestamp: string,
  body: string,
  providedSignature: string
): boolean {
  const expected = computeSyncSignature(secret, timestamp, body);
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(providedSignature, "hex");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function isTimestampWithinSkew(
  timestamp: string,
  now: Date,
  maxSkewSeconds: number
): boolean {
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const skewSeconds = Math.abs(now.getTime() - parsed.getTime()) / 1000;

  return skewSeconds <= maxSkewSeconds;
}
