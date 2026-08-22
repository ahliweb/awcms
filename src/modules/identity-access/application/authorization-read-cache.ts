/**
 * A per-render memo for the reads `authorizeInTransaction` repeats — finding B1
 * of the 17 August 2026 audit round.
 *
 * ## What was measured
 *
 * `/admin/blog` calls `can()` ten times on top of its entry decision. Each one
 * is a full `authorizeInTransaction`, and each re-resolves the same session, the
 * same permission set and the same tenant state. Against a real database:
 *
 *   11 authorization calls -> **89 queries**, 89 ms, on ONE reserved
 *   `interactive` connection (max 8 process-wide).
 *
 * Roughly eight queries per call, of which the great majority are byte-identical
 * re-reads: the caller has not changed, the tenant has not changed, and the
 * transaction has not committed anything in between.
 *
 * ## Why a cache the CALLER passes in, and not one inside the guard
 *
 * A cache keyed on `tx` inside `authorizeInTransaction` would speed up every
 * caller, and would also change what a caller sees after IT has written. A route
 * that grants a role and then re-authorizes in the same transaction would read
 * the grant set from before its own write — silently, and only sometimes.
 *
 * So the cache is an OPT-IN the caller supplies. `loadAdminScreen` creates one
 * per render and hands it to the entry decision and to every `can()` probe,
 * because a screen render is exactly the case where nothing changes in between:
 * it is a read path by construction, and the eleven decisions describe one
 * moment. Every other caller is untouched and keeps reading fresh.
 *
 * ## What is NOT cached, and why that is the whole safety argument
 *
 * Only reads whose answer cannot differ between two decisions ABOUT THE SAME
 * PRINCIPAL IN THE SAME TRANSACTION:
 *
 *   - the resolved principal (session -> tenant user + tenant status);
 *   - the machine credential behind a machine token;
 *   - the granted permission KEYS for that tenant user;
 *   - the delegated grant state (expiry + partner registry status);
 *   - the platform tenant id.
 *
 * Everything that depends on the REQUEST is re-evaluated every time: module
 * availability and entitlement, the delegated-write rule, the machine-credential
 * write ceiling, business-scope facts, SoD, the ABAC policy evaluation itself,
 * and the decision log. A cached decision would be a different feature with a
 * different risk; this caches the inputs, not the answer.
 *
 * `loadActivePolicies` already has its own cache and is deliberately left to it.
 *
 * ## Promises, not values
 *
 * Entries hold the in-flight promise so two concurrent probes for the same key
 * share one round trip rather than racing to fill the same slot. Nothing here
 * runs concurrently today — `loadAdminScreen` awaits each `can()` in turn,
 * because `tx` is one connection — and storing the promise costs nothing and
 * removes the question.
 *
 * A rejected read is NOT retained: the entry is dropped so a transient failure
 * does not become the answer for the rest of the render.
 */
export type AuthorizationReadCache = {
  /** Keyed by a string the caller builds from every argument that can change the answer. */
  entries: Map<string, Promise<unknown>>;
};

export function createAuthorizationReadCache(): AuthorizationReadCache {
  return { entries: new Map() };
}

/**
 * Runs `read` once per key and reuses it after.
 *
 * `cache` is optional so a call site can be written once and work for both the
 * cached and uncached caller — which is what keeps `authorizeInTransaction`
 * readable rather than forked into two versions.
 */
export function cachedRead<T>(
  cache: AuthorizationReadCache | undefined,
  key: string,
  read: () => Promise<T>
): Promise<T> {
  if (!cache) return read();

  const existing = cache.entries.get(key);
  if (existing) return existing as Promise<T>;

  const pending = read().catch((error: unknown) => {
    // A failed read must not be the cached answer for the rest of the render.
    cache.entries.delete(key);
    throw error;
  });

  cache.entries.set(key, pending);

  return pending;
}
