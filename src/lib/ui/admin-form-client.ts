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
 *
 * ## Why the lifecycle helpers below exist (Issue #552)
 *
 * Measured on 2026-08-13, per-page script chunks were 98,379 B of a 180,000 B
 * client budget — 56% of everything the browser downloads, across 43 files
 * that shared 1,039 B between them. Nearly every admin mutation was writing
 * the same nine statements by hand: read a message box, guard a
 * double-click, lock the button, clear the box, send, reload on success,
 * otherwise map an error code to a sentence and unlock. Ninety-two reload
 * sites and 106 `lockElement` sites is not a DRY complaint — it is the same
 * bytes shipped ninety-two times, and ninety-two places the behaviour on
 * failure can quietly drift apart.
 *
 * So the helpers here own the LIFECYCLE and leave the page the two things that
 * are genuinely its own: what to send, and what to say when it fails.
 *
 * They are positional rather than an options object on purpose. An options
 * object costs its property names at every call site — about 30 B minified,
 * ninety-two times — which is a meaningful slice of the saving this exists to
 * produce.
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

/** The methods every admin mutation helper here accepts. */
export type JsonMutationMethod = "POST" | "PATCH" | "PUT" | "DELETE";

/** The response envelope every endpoint in this app answers with. */
type JsonEnvelope = {
  success?: boolean;
  data?: unknown;
  error?: { code?: string; details?: unknown };
};

/**
 * What {@link sendJsonRequest} answers: the narrow verdict every caller wants,
 * plus the raw envelope for the two that want more.
 */
export type JsonRequestResult = {
  ok: boolean;
  errorCode: string | null;
  payload: JsonEnvelope | null;
};

/**
 * The ONE same-origin JSON mutation in this codebase (finding D12).
 *
 * There used to be three near-identical copies of this fetch — `sendJson`,
 * `sendJsonForData` here, and `sendJsonWithFieldErrors` in
 * `admin-field-errors-client.ts` — and they had already drifted: two supported
 * `extraHeaders`, bodyless requests and `DELETE`; the third supported none of
 * it, so `/admin/seo` reported "invalid" without saying which field for no
 * reason anybody chose. Three copies of a fetch is also three copies of the
 * bytes, on a client budget that is measured.
 *
 * The three survive as PROJECTIONS of this one. They are not merged into a
 * single public function, because their differing return shapes are a real
 * control: `sendJson`'s narrow `{ ok, errorCode }` is what stops thirty-odd
 * call sites from painting internal detail onto the page (Issue #540), and
 * widening it for everyone to serve two callers would remove that property
 * from all of them.
 *
 * Uses COOKIE auth: the session + tenant cookies ride along automatically
 * (`credentials: "same-origin"`), and `resolveAuthInputs` reads the tenant from
 * the `awcms_tenant_id` cookie — so an admin-page form needs no manual
 * `X-AWCMS-Tenant-ID` header.
 *
 * `body` is optional so a bodyless mutation (e.g. `DELETE /roles/{id}`, a
 * restore/toggle) can be sent without an empty-object payload; when omitted no
 * request body and no `Content-Type` header are attached.
 *
 * `extraHeaders` is merged UNDER the `Content-Type` a JSON body sets, never
 * over it — used by high-risk mutations that must carry an `Idempotency-Key`.
 * (The field-errors copy merged them the other way round, so a caller could
 * have overridden `Content-Type`; nothing did, and this order is the one both
 * docblocks claimed.)
 *
 * Never throws.
 */
export async function sendJsonRequest(
  method: JsonMutationMethod,
  url: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<JsonRequestResult> {
  try {
    const hasBody = body !== undefined;
    const headers: Record<string, string> = { ...extraHeaders };

    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      credentials: "same-origin",
      body: hasBody ? JSON.stringify(body) : undefined
    });
    const payload = (await response
      .json()
      .catch(() => null)) as JsonEnvelope | null;

    if (response.ok && payload?.success === true) {
      return { ok: true, errorCode: null, payload };
    }

    return { ok: false, errorCode: payload?.error?.code ?? null, payload };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR", payload: null };
  }
}

/**
 * Sends a JSON body and returns ONLY `{ ok, errorCode }` — the shape callers
 * show a generic message from, so no screen can surface internal detail by
 * accident (Issue #540). What most admin buttons want.
 */
export async function sendJson(
  method: JsonMutationMethod,
  url: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ ok: boolean; errorCode: string | null }> {
  const { ok, errorCode } = await sendJsonRequest(
    method,
    url,
    body,
    extraHeaders
  );

  return { ok, errorCode };
}

/**
 * As {@link sendJson}, but ALSO returns the response `data` — for the one class
 * of endpoint whose whole point is what it hands back.
 *
 * ## Why this is separate, and should stay rare
 *
 * `sendJson`'s narrow shape is deliberate: widening it for everyone would
 * remove that property from 30-odd call sites to serve two.
 *
 * The exception exists for responses like the delegated-access approval, which
 * returns a single-use code that appears EXACTLY ONCE and cannot be re-read.
 * Discarding it would mean the operator has to revoke the grant and approve a
 * new one — a worse outcome than the narrow shape protects against.
 *
 * The error half stays narrow: on failure this returns `data: null` and the
 * same `errorCode`, so a failed call still cannot leak anything.
 */
export async function sendJsonForData<TData>(
  method: JsonMutationMethod,
  url: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ ok: boolean; errorCode: string | null; data: TData | null }> {
  const result = await sendJsonRequest(method, url, body, extraHeaders);

  return {
    ok: result.ok,
    errorCode: result.errorCode,
    data: result.ok
      ? ((result.payload?.data as TData | undefined) ?? null)
      : null
  };
}

/** What {@link sendJson} answers — the half {@link mutateAndReload} reads. */
export type MutationOutcome = { ok: boolean; errorCode: string | null };

/**
 * A message region on an admin page: hidden until something goes wrong.
 *
 * Every screen had its own three-line `showError` closing over its own
 * `getElementById`. The element is looked up ONCE here, at module evaluation,
 * which is also when the page's own copies did it.
 *
 * `show` tolerates a missing element rather than throwing, because the boxes
 * are frequently inside a permission-gated branch: a viewer without the write
 * permission gets a page where the box was never rendered, and a mutation they
 * cannot trigger is not a reason for a TypeError in the console.
 */
export type MessageBox = {
  show(message: string): void;
  clear(): void;
};

export function messageBox(id: string): MessageBox {
  const element = document.getElementById(id);

  return {
    show(message: string): void {
      if (!element) return;
      element.textContent = message;
      element.hidden = false;
    },
    clear(): void {
      if (element) element.hidden = true;
    }
  };
}

/**
 * Reads a text field out of a `FormData` the way every admin form wants it:
 * a string, never `null`, never a `File`, trimmed.
 *
 * `String(data.get(name) ?? "").trim()` appeared 112 times across the pages.
 */
export function field(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

/**
 * Trimmed value of an input / select / textarea by element ID — for the panels
 * that are a group of controls rather than a `<form>`, so there is no
 * `FormData` to read.
 *
 * Absent element → `""`, deliberately. These controls sit inside
 * permission-gated branches, so "not rendered" is a normal state and a throw
 * here would take out the whole handler.
 */
export function inputValue(id: string): string {
  const element = document.getElementById(id) as
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  return element ? element.value.trim() : "";
}

/** Blank text → `null`, which these APIs read as "unset this field". */
export function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * A `datetime-local` control's value as an ABSOLUTE instant, or `null` when it
 * is blank or unparseable.
 *
 * This is not a convenience. `datetime-local` yields `2026-08-21T09:00` with no
 * zone, and every endpoint in this repo that accepts a schedule hands the string
 * to `new Date(...)` on the SERVER — which reads it in the server's timezone,
 * not the operator's. A campaign scheduled from Palangka Raya would start at the
 * wrong hour and nothing would report an error, because both sides parsed
 * successfully.
 *
 * Converting in the browser is the only place the operator's own offset is
 * known, so every screen with a schedule field must go through here.
 */
export function localDateTimeToInstant(id: string): string | null {
  const raw = inputValue(id);

  if (!raw) return null;

  const parsed = new Date(raw);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * A checkbox's state by element ID.
 *
 * Read from the ELEMENT, never from `FormData`: an unchecked checkbox is absent
 * from `FormData` entirely, so `field(data, "isActive")` cannot tell "unchecked"
 * apart from "the control was never rendered" — and those two must produce
 * different requests on a permission-gated screen.
 */
export function checkboxChecked(id: string, fallback = false): boolean {
  const element = document.getElementById(id);

  return element instanceof HTMLInputElement ? element.checked : fallback;
}

/** An integer control by element ID, falling back when blank or not a number. */
export function integerValue(id: string, fallback: number): number {
  const parsed = Number(inputValue(id));

  return Number.isInteger(parsed) ? parsed : fallback;
}

/** What {@link onSubmit} hands its handler. */
export type SubmitContext = {
  form: HTMLFormElement;
  data: FormData;
  /**
   * The form's `type="submit"` button, for {@link mutateAndReload} to lock.
   *
   * `null` when the markup has none. That is not treated as a reason to abort:
   * a submit event cannot fire without a submit control, so a null here means
   * the markup changed shape, and refusing to send would turn a cosmetic
   * regression into a dead form with no message.
   */
  submit: HTMLButtonElement | null;
};

/**
 * Binds a submit handler to the form with `formId`, with `preventDefault`
 * already called and the `FormData` already read.
 *
 * Binding is unconditional and silently does nothing when the form is absent —
 * which is the normal case, not an error: admin forms render only inside a
 * `canCreate`-style branch, while Astro hoists every `<script>` at build time
 * and ships it to every viewer of the page.
 */
function submitContext(form: HTMLFormElement): SubmitContext {
  return {
    form,
    data: new FormData(form),
    submit: form.querySelector<HTMLButtonElement>('button[type="submit"]')
  };
}

export function onSubmit(
  formId: string,
  handler: (context: SubmitContext) => void | Promise<void>
): void {
  const form = document.getElementById(formId);
  if (!(form instanceof HTMLFormElement)) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handler(submitContext(form));
  });
}

/**
 * As {@link onSubmit}, but for the pages that render one form PER ROW —
 * a grant form per role, a reply form per comment — where there is no single
 * id to bind to and binding per row would be one listener per row.
 */
export function onSubmitAll(
  selector: string,
  handler: (context: SubmitContext) => void | Promise<void>
): void {
  document.addEventListener("submit", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const form = target.closest(selector);
    if (!(form instanceof HTMLFormElement)) return;

    event.preventDefault();
    void handler(submitContext(form));
  });
}

/**
 * Binds ONE delegated click listener for every button matching `selector`.
 *
 * Delegation rather than `querySelectorAll(...).forEach(addEventListener)`:
 * one listener instead of one per row, and it keeps working for rows the page
 * renders later. Disabled buttons are skipped here so no caller repeats the
 * double-click guard.
 */
export function onAction(
  selector: string,
  handler: (button: HTMLButtonElement) => void | Promise<void>
): void {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest(selector);
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;

    void handler(button);
  });

  markDelegationReady();
}

/**
 * The attribute that says at least one delegated listener is attached.
 *
 * ## The window it makes visible
 *
 * These listeners live on `document` and only exist once the page's module has
 * run. Astro emits component scripts as `<script type="module">`, which is
 * deferred — so between first paint and that execution, every delegated admin
 * control is in the DOM, looks enabled, and does NOTHING when clicked. No
 * request, no message, no error: the click is discarded by a document that is
 * not listening yet.
 *
 * On a normal connection that window is tens of milliseconds. It is not
 * nothing: it is why `tests/e2e/admin-users.e2e.ts` was intermittently red, and
 * a slow connection makes it a real operator experience — press Assign, watch
 * nothing happen, press it again.
 *
 * This marker does not close the window; closing it would mean gating 76
 * controls that share no selector convention, which risks disabling things that
 * work without JavaScript. What it does is make the window **observable**, so a
 * test can wait for readiness instead of racing it, and so the next person to
 * meet this has something to look at rather than a timeout.
 */
export const ADMIN_DELEGATION_READY_ATTRIBUTE = "data-admin-delegation-ready";

function markDelegationReady(): void {
  // Idempotent: `onAction` is called many times per page (up to a dozen on the
  // larger screens) and every call attaches a real listener, so the FIRST one
  // is the honest moment to say the page can hear a click.
  document.documentElement.setAttribute(
    ADMIN_DELEGATION_READY_ATTRIBUTE,
    "true"
  );
}

/**
 * The lifecycle every admin mutation shares: lock the control, clear the
 * message, send, reload on success, otherwise say what went wrong and unlock.
 *
 * `failure` is a plain string when one sentence covers every way the call can
 * fail, or a function when a particular `errorCode` deserves its own — which
 * is the only part of this a page genuinely has to decide.
 *
 * There is deliberately no `unlock()` on the success path. The page is being
 * replaced; restoring the button first would flash the old label and briefly
 * re-arm a control whose row is about to disappear.
 */
export async function mutateAndReload(
  button: HTMLButtonElement | null,
  box: MessageBox,
  send: () => Promise<MutationOutcome>,
  failure: string | ((errorCode: string | null) => string),
  busyLabel = "Please wait…"
): Promise<void> {
  box.clear();
  const unlock = button ? lockElement(button, busyLabel) : () => {};

  const result = await send();

  if (result.ok) {
    window.location.reload();
    return;
  }

  box.show(typeof failure === "string" ? failure : failure(result.errorCode));
  unlock();
}
