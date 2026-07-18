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
