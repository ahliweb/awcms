/**
 * `ReasonPanel`'s client half (Issue #854 part 3) — see
 * `../../components/ReasonPanel.astro` for the markup, the full `data-*`
 * contract table, and a usage demo.
 *
 * ## Why this is one shared module rather than per-page script
 *
 * The consumers this replaces (module disable in `modules.astro`, newsletter
 * subscriber suppress in `newsletter.astro`, and the other reason-required
 * `window.prompt()` sites converted alongside it) are otherwise identical in
 * shape: a button, a required reason, a mutation carrying `{ reason }`.
 * Writing that lifecycle once here — and reading its target entirely from the
 * opener's own `data-reason-*` attributes — means adopting the panel on
 * another screen needs zero new JavaScript, only markup.
 *
 * ## Two submit modes
 *
 * - **fetch** (`data-reason-action` on the opener): this module sends
 *   `{ [field]: reason }` as JSON itself, using the same `sendJson`/
 *   `lockElement` primitives every other admin mutation in this app uses,
 *   then reloads on success.
 * - **form** (`data-reason-form` on the opener): this module writes the
 *   reason into a hidden field on an EXISTING form and calls
 *   `form.requestSubmit()`, so a page that already owns its own submit
 *   handling keeps deciding what happens next; this module's job ends at
 *   "the form now carries the reason and was asked to submit".
 *
 * `data-reason-action` and `data-reason-form` are mutually exclusive; an
 * opener with neither is skipped (nothing to submit to) — matching this
 * codebase's existing "malformed data-* → do nothing" convention (see
 * `onAction`/`onSubmit` in `admin-form-client.ts`).
 *
 * ## Opting into an `Idempotency-Key`
 *
 * `data-reason-idempotent` (presence, fetch mode only) makes this module send
 * an `Idempotency-Key` header alongside the JSON body, in the same
 * `crypto.randomUUID()` shape every other high-risk admin mutation in this
 * app uses.
 *
 * The key is generated ONCE per panel OPEN, not once per click: a submit that
 * fails (network error, a 4xx the operator can retry after adjusting the
 * reason) leaves the panel open, and a second click must reuse the SAME key
 * so the endpoint's replay guard recognises it as the same attempt rather
 * than a second mutation. Closing the panel (Cancel, Escape, or a successful
 * submit) and opening it again draws a fresh key, because that is genuinely a
 * new attempt.
 */
import { lockElement, sendJson } from "./admin-form-client";

/** Matches `ReasonPanel.astro`'s default `id` prop. */
export const DEFAULT_REASON_PANEL_ID = "admin-reason-panel";

/** Every opener button carries this attribute — the delegated click listener's selector. */
export const REASON_OPENER_SELECTOR = "[data-reason-title]";

/** A resolved, validated configuration for ONE opener button's click. */
export type ReasonPanelConfig = {
  title: string;
  description: string | null;
  submitLabel: string;
  busyLabel: string;
  failureMessage: string;
  danger: boolean;
  minLength: number;
  /** `null` → no cap (the textarea's native `maxlength` is left unset). */
  maxLength: number | null;
  field: string;
} & (
  | { mode: "fetch"; action: string; method: string; idempotent: boolean }
  | { mode: "form"; formId: string }
);

/** What an opener button's `dataset` looks like, read verbatim (all optional — HTML gives every `data-*` as a string or `undefined`). */
export type ReasonOpenerDataset = {
  reasonTitle?: string;
  reasonDescription?: string;
  reasonAction?: string;
  reasonMethod?: string;
  reasonForm?: string;
  reasonField?: string;
  reasonMinLength?: string;
  reasonMaxLength?: string;
  reasonLabel?: string;
  reasonDanger?: string;
  reasonBusyLabel?: string;
  reasonFailure?: string;
  reasonIdempotent?: string;
};

/** Fallback strings the panel itself declared (its `data-default-*` attributes). */
export type ReasonPanelDefaults = {
  defaultSubmitLabel: string;
  defaultBusyLabel: string;
  defaultFailureMessage: string;
};

/**
 * Turns one opener's dataset into a config, or `null` when it cannot be
 * acted on — no title, or neither `action` nor `form` given, or BOTH given
 * (ambiguous: this module refuses to guess which one wins).
 *
 * Pure — no DOM read beyond the plain object passed in — so this is the one
 * function a test can drive directly without a fake `document`.
 */
export function resolveOpenerConfig(
  dataset: ReasonOpenerDataset,
  defaults: ReasonPanelDefaults
): ReasonPanelConfig | null {
  const title = dataset.reasonTitle?.trim();
  if (!title) return null;

  const hasAction = Boolean(dataset.reasonAction);
  const hasForm = Boolean(dataset.reasonForm);
  if (hasAction === hasForm) return null; // neither, or both — refuse.

  const minLengthRaw = Number(dataset.reasonMinLength);
  const minLength =
    Number.isInteger(minLengthRaw) && minLengthRaw > 0 ? minLengthRaw : 1;

  const maxLengthRaw = Number(dataset.reasonMaxLength);
  const maxLength =
    Number.isInteger(maxLengthRaw) && maxLengthRaw > 0 ? maxLengthRaw : null;

  const shared = {
    title,
    description: dataset.reasonDescription?.trim() || null,
    submitLabel: dataset.reasonLabel?.trim() || defaults.defaultSubmitLabel,
    busyLabel: dataset.reasonBusyLabel?.trim() || defaults.defaultBusyLabel,
    failureMessage:
      dataset.reasonFailure?.trim() || defaults.defaultFailureMessage,
    danger: dataset.reasonDanger !== undefined,
    minLength,
    maxLength,
    field: dataset.reasonField?.trim() || "reason"
  };

  if (hasAction) {
    return {
      ...shared,
      mode: "fetch",
      action: dataset.reasonAction!,
      method: dataset.reasonMethod?.trim().toUpperCase() || "POST",
      // Presence-based, same convention as `danger` above — the value of
      // `data-reason-idempotent` (if any) is never read, only whether the
      // attribute is there at all.
      idempotent: dataset.reasonIdempotent !== undefined
    };
  }

  return { ...shared, mode: "form", formId: dataset.reasonForm! };
}

/** Whether a reason value clears the panel's minimum-length bar. Pure. */
export function isReasonValid(value: string, minLength: number): boolean {
  return value.trim().length >= minLength;
}

type PanelElements = {
  dialog: HTMLDialogElement;
  title: HTMLElement;
  description: HTMLElement;
  textarea: HTMLTextAreaElement;
  counter: HTMLElement;
  error: HTMLElement;
  submit: HTMLButtonElement;
  cancel: HTMLButtonElement;
  close: HTMLButtonElement;
};

function findElements(dialog: HTMLDialogElement): PanelElements | null {
  const title = dialog.querySelector<HTMLElement>(".reason-panel-title");
  const description = dialog.querySelector<HTMLElement>(
    "[data-reason-panel-description]"
  );
  const textarea = dialog.querySelector<HTMLTextAreaElement>(
    "[data-reason-panel-textarea]"
  );
  const counter = dialog.querySelector<HTMLElement>(
    "[data-reason-panel-counter]"
  );
  const error = dialog.querySelector<HTMLElement>("[data-reason-panel-error]");
  const submit = dialog.querySelector<HTMLButtonElement>(
    "[data-reason-panel-submit]"
  );
  const cancel = dialog.querySelector<HTMLButtonElement>(
    "[data-reason-panel-cancel]"
  );
  const close = dialog.querySelector<HTMLButtonElement>(
    "[data-reason-panel-close]"
  );

  if (
    !title ||
    !description ||
    !textarea ||
    !counter ||
    !error ||
    !submit ||
    !cancel ||
    !close
  ) {
    return null;
  }

  return {
    dialog,
    title,
    description,
    textarea,
    counter,
    error,
    submit,
    cancel,
    close
  };
}

/**
 * Wires the ONE `ReasonPanel` on the page (see the component docblock — this
 * is a shared, page-level instance, not one per row) to every opener button
 * matching {@link REASON_OPENER_SELECTOR}.
 *
 * Silently does nothing when the panel is absent from the page — the normal
 * case for a screen that renders no reason-required action at all.
 */
export function initReasonPanel(
  panelId: string = DEFAULT_REASON_PANEL_ID
): void {
  const dialogElement = document.getElementById(panelId);
  if (!(dialogElement instanceof HTMLDialogElement)) return;

  // Control-flow narrowing from the `instanceof` check above does not
  // survive into the nested function declarations below — `panel` is a
  // SEPARATE binding that carries the narrowed type explicitly, so every
  // closure below reads a real `HTMLDialogElement`, never `HTMLElement | null`.
  const panel: HTMLDialogElement = dialogElement;

  const elements = findElements(panel);
  if (!elements) return;

  const defaults: ReasonPanelDefaults = {
    defaultSubmitLabel: panel.dataset.defaultSubmitLabel ?? "Confirm",
    defaultBusyLabel: panel.dataset.defaultBusyLabel ?? "Please wait…",
    defaultFailureMessage:
      panel.dataset.defaultFailureMessage ??
      "Could not save this action. Please try again."
  };

  let active: ReasonPanelConfig | null = null;

  /**
   * Set once per `openFor()` call, for a fetch-mode config that opted into
   * `data-reason-idempotent` — never regenerated by a retry within the same
   * open. `null` otherwise (form mode, or a fetch config that did not opt
   * in), so its presence alone says whether a header should be sent.
   */
  let activeIdempotencyKey: string | null = null;

  function resetPanel(): void {
    elements!.textarea.value = "";
    elements!.error.hidden = true;
    elements!.error.textContent = "";
    elements!.counter.textContent = "";
    updateSubmitEnabled();
  }

  function updateSubmitEnabled(): void {
    if (!active) return;
    elements!.submit.disabled = !isReasonValid(
      elements!.textarea.value,
      active.minLength
    );
  }

  function openFor(config: ReasonPanelConfig): void {
    active = config;
    // Drawn HERE, once per open — not in the submit handler, which a retry
    // after a failed attempt re-enters without a fresh open.
    activeIdempotencyKey =
      config.mode === "fetch" && config.idempotent ? crypto.randomUUID() : null;
    elements!.title.textContent = config.title;
    // `removeAttribute` rather than `maxLength = -1`: an unset native
    // `maxlength` must be genuinely ABSENT, not a sentinel the browser could
    // interpret as zero-length.
    if (config.maxLength === null) {
      elements!.textarea.removeAttribute("maxlength");
    } else {
      elements!.textarea.maxLength = config.maxLength;
    }
    elements!.description.hidden = config.description === null;
    elements!.description.textContent = config.description ?? "";
    elements!.submit.textContent = config.submitLabel;
    elements!.submit.classList.toggle("btn-danger--solid", config.danger);
    elements!.submit.classList.toggle("btn-primary", !config.danger);
    resetPanel();
    panel.showModal();
    elements!.textarea.focus();
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const opener = target.closest(REASON_OPENER_SELECTOR);
    if (!(opener instanceof HTMLButtonElement) || opener.disabled) return;

    const config = resolveOpenerConfig(
      opener.dataset as ReasonOpenerDataset,
      defaults
    );
    if (!config) return;

    openFor(config);
  });

  elements.textarea.addEventListener("input", updateSubmitEnabled);

  function closePanel(): void {
    if (panel.open) panel.close();
    active = null;
  }

  elements.cancel.addEventListener("click", closePanel);
  elements.close.addEventListener("click", closePanel);
  panel.addEventListener("cancel", () => {
    active = null;
  });

  elements.submit.addEventListener("click", async () => {
    if (!active) return;
    const reason = elements!.textarea.value.trim();
    if (!isReasonValid(reason, active.minLength)) return;

    if (active.mode === "form") {
      const form = document.getElementById(active.formId);
      if (!(form instanceof HTMLFormElement)) return;

      let hidden = form.querySelector<HTMLInputElement>(
        `input[name="${active.field}"]`
      );
      if (!hidden) {
        hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = active.field;
        form.appendChild(hidden);
      }
      hidden.value = reason;

      closePanel();
      form.requestSubmit();
      return;
    }

    const config = active;
    const unlock = lockElement(elements!.submit, config.busyLabel);
    elements!.error.hidden = true;

    const extraHeaders =
      config.idempotent && activeIdempotencyKey
        ? { "Idempotency-Key": activeIdempotencyKey }
        : undefined;

    const result = await sendJson(
      config.method as "POST" | "PATCH" | "PUT" | "DELETE",
      config.action,
      { [config.field]: reason },
      extraHeaders
    );

    if (result.ok) {
      if (panel.open) panel.close();
      window.location.reload();
      return;
    }

    elements!.error.hidden = false;
    elements!.error.textContent = config.failureMessage;
    unlock();
  });
}
