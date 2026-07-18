/**
 * Tiny client-side helpers shared by the admin/login page `<script>`s
 * (Issue #166, ported from awcms-mini's `admin-form-client.ts`).
 *
 * Its existence as an IMPORTED module is load-bearing for CSP, not just DRY:
 * Astro inlines a hoisted `<script>` that has no imports (emitting
 * `<script type="module">…code…</script>`), but bundles one that DOES import
 * into an EXTERNAL `/_astro/*.js` file. This app's middleware CSP is
 * `default-src 'self'` with no `'unsafe-inline'` (see astro.config.mjs /
 * security-headers.ts), so an inline script is BLOCKED and the page's
 * behaviour silently dies. Importing `lockElement` from here forces every
 * page script that uses it external, where `'self'` allows it. Verified
 * empirically: without the import the login script inlined; with it, it emits
 * an external module.
 */

/**
 * Disables a button and swaps its label to a busy string for the duration of
 * an async action, returning an `unlock()` that restores both. Guards against
 * double-submit (a fast double-click firing two requests before a redirect).
 */
export function lockElement(
  element: HTMLButtonElement,
  busyLabel: string
): () => void {
  const originalLabel = element.textContent;
  element.disabled = true;
  element.textContent = busyLabel;

  let unlocked = false;
  return () => {
    if (unlocked) return;
    unlocked = true;
    element.disabled = false;
    element.textContent = originalLabel;
  };
}

/**
 * Sends a JSON body to a same-origin admin API endpoint with the given HTTP
 * method, using COOKIE auth: the session + tenant cookies ride along
 * automatically (`credentials: "same-origin"`), and `resolveAuthInputs` reads
 * the tenant from the `awcms_tenant_id` cookie — so an admin-page form needs no
 * manual `X-AWCMS-Tenant-ID` header. Returns a narrow `{ ok, errorCode }` so
 * callers show a generic message keyed off `errorCode` and never surface
 * internal detail (Issue #540). Never throws.
 *
 * `body` is optional so a bodyless mutation (e.g. `DELETE /roles/{id}`, a
 * restore/toggle) can be sent without an empty-object payload; when omitted no
 * request body and no `Content-Type` header are attached.
 */
export async function sendJson(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown
): Promise<{ ok: boolean; errorCode: string | null }> {
  try {
    const hasBody = body !== undefined;
    const response = await fetch(url, {
      method,
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      credentials: "same-origin",
      body: hasBody ? JSON.stringify(body) : undefined
    });
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      error?: { code?: string };
    } | null;

    if (response.ok && payload?.success === true) {
      return { ok: true, errorCode: null };
    }
    return { ok: false, errorCode: payload?.error?.code ?? null };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR" };
  }
}

/**
 * POSTs a JSON body to a same-origin admin API endpoint. Thin wrapper over
 * {@link sendJson} kept for the existing create-form call sites; new edit /
 * delete / toggle forms should call `sendJson` with the appropriate method.
 */
export async function postJson(
  url: string,
  body: unknown
): Promise<{ ok: boolean; errorCode: string | null }> {
  return sendJson("POST", url, body);
}
