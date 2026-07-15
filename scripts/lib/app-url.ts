/**
 * app-url.ts — resolve the application's base URL for scripts that need to
 * reach a running server (`scripts/db-pool-health.ts`,
 * `scripts/security-readiness.ts`'s error-leak check,
 * `scripts/production-preflight.ts`'s reachability probe).
 *
 * `APP_URL` already exists in `.env.example` (Issue 0.1) as the app's own
 * public base URL — reused here rather than inventing a second env var,
 * defaulting to the same `http://localhost:4321` value documented there.
 */
export const DEFAULT_APP_BASE_URL = "http://localhost:4321";

export function resolveAppBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = env.APP_URL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_APP_BASE_URL;
}

/**
 * Best-effort liveness probe against `GET /api/v1/health` with a short
 * timeout. Any HTTP response (even a non-2xx one) counts as "reachable" —
 * this only answers "is something listening at this URL", not "is the app
 * fully healthy" (that's what `/api/v1/database/pool/health` and
 * `security:readiness` are for).
 */
export async function isServerReachable(
  baseUrl: string,
  timeoutMs = 1500
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(new URL("/api/v1/health", baseUrl), {
      signal: controller.signal
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
