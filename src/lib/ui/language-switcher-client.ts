/**
 * Client behaviour for `LanguageSwitcher.astro`.
 *
 * ## Why this is a MODULE and not a `<script>` body
 *
 * Two reasons, and the second one is why the switcher was dead in production.
 *
 * 1. A `<script>` inside an `.astro` file is not typechecked by `tsc` — the
 *    blind spot `check:astro-scripts:check` exists to cover.
 * 2. Astro decides where a component script goes by whether it still has
 *    imports AFTER bundling. A script with none is written into the SSR
 *    manifest's `inlinedScripts` and rendered INLINE — and this repo's CSP is
 *    `script-src 'self' 'sha256-…'` with exactly one hash, the theme-init
 *    script. An inline script it does not know the hash of never executes.
 *
 * The previous version tried to hold its import in place with a guard:
 *
 *     if (typeof LOCALE_COOKIE_NAME !== "string") throw new Error(…)
 *
 * `LOCALE_COOKIE_NAME` is a `const` string, so the minifier proved the test
 * false, deleted the branch, found the import unused, and elided it. The script
 * became import-free and was inlined — exactly the outcome the guard was written
 * to prevent, with the comment still there claiming it could not happen.
 *
 * A bare side-effect `import "…"` in the `.astro` cannot be elided, because
 * dropping it would drop observable behaviour. That is what makes this file the
 * mechanism rather than a decoration.
 */
import { LOCALE_COOKIE_NAME } from "../i18n/request-locale";

const form = document.querySelector<HTMLFormElement>(".locale-switcher");
const select = form?.querySelector<HTMLSelectElement>(
  ".locale-switcher-select"
);

/** True when the server actually set the cookie we are about to reload for. */
function localeCookieIsSet(): boolean {
  return document.cookie
    .split("; ")
    .some((entry) => entry.startsWith(`${LOCALE_COOKIE_NAME}=`));
}

async function applyLocale(): Promise<void> {
  if (!form || !select) return;

  const returnTo = form.querySelector<HTMLInputElement>(
    'input[name="return_to"]'
  )?.value;

  select.disabled = true;

  try {
    const response = await fetch(form.action, {
      method: "POST",
      // JSON, not the form encoding a native submit would use. Astro's
      // `checkOrigin` refuses form-like content types unless the `Origin` header
      // equals `url.origin`, and behind TLS termination those never match: the
      // app listens on plain HTTP, so its `url.origin` is `http://…` while the
      // browser sends `https://…`. JSON is exempt because a cross-site
      // `application/json` POST is already stopped by CORS preflight.
      headers: { "Content-Type": "application/json" },
      // The anonymous endpoint needs no session; the persisting one is
      // bearer-gated and would answer 401 without this.
      credentials: "same-origin",
      body: JSON.stringify({ locale: select.value, return_to: returnTo })
    });

    if (!response.ok || !localeCookieIsSet()) {
      // Reloading after a refusal would just re-render the same language and
      // look like the control silently did nothing.
      select.disabled = false;
      return;
    }

    // Re-request the page rather than swapping text in place: the locale decides
    // the server-rendered document, `<html lang>` included.
    window.location.reload();
  } catch {
    select.disabled = false;
  }
}

if (form && select) {
  select.addEventListener("change", () => {
    // `requestSubmit()` rather than `submit()`: the latter does not fire submit
    // handlers, so it would bypass the listener below and fall through to the
    // native form POST this deployment answers with 403.
    form.requestSubmit();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void applyLocale();
  });
}
