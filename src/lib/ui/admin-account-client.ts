/**
 * Client behaviour for `/admin/account` (ADR-0096).
 *
 * ## Why this is a separate module rather than inline in the `.astro`
 *
 * Two reasons, both enforced:
 *
 *  1. **CSP.** `src/lib/security/security-headers.ts` owns a single
 *     `default-src 'self'` with no `'unsafe-inline'`; the one inline script in
 *     this repo is the theme-init, admitted by SHA-256. An import-bearing
 *     `<script>` makes Astro emit an external module, which passes `'self'`.
 *  2. **Typechecking.** `.astro` `<script>` blocks are NOT covered by `tsc`
 *     (40 admin screens shipped untypechecked client behaviour before
 *     `check:astro-scripts:check` landed). Code in a `.ts` file beside the page
 *     is checked like everything else.
 *
 * ## Why user-facing strings arrive as data attributes
 *
 * The message catalog is a SERVER module. Importing it here would ship every
 * locale's strings to every browser, and reading it at runtime is impossible
 * anyway. So the page renders the translated strings it needs onto
 * `#account-i18n` and this file reads them, with English fallbacks so a missing
 * attribute degrades to a readable message rather than `undefined`. Same seam
 * `ThemeToggle` uses for its three mode labels.
 */
import {
  field,
  mutateAndReload,
  messageBox,
  onAction,
  onSubmit,
  sendJson,
  sendJsonForData
} from "./admin-form-client";

/** Translated strings the page rendered for us, with English fallbacks. */
function message(key: string, fallback: string): string {
  const host = document.getElementById("account-i18n");

  return host?.dataset[key] ?? fallback;
}

const profileError = messageBox("account-profile-error");
const preferencesError = messageBox("account-preferences-error");
const passwordError = messageBox("account-password-error");
const mfaError = messageBox("account-mfa-error");
const sessionsError = messageBox("account-sessions-error");

/**
 * `""` from a `<select>` means "not chosen" and must reach the API as `null`,
 * not as the empty string — sql/128 models the unset state as NULL and the
 * endpoint distinguishes ABSENT (leave alone) from null (reset). Sending `""`
 * would fail validation as an unsupported locale.
 */
function selectValueOrNull(id: string): string | null {
  const element = document.getElementById(id);
  const value =
    element instanceof HTMLSelectElement ? element.value.trim() : "";

  return value === "" ? null : value;
}

// ---------------------------------------------------------------- profile --

onSubmit("account-profile-form", async ({ data, submit }) => {
  await mutateAndReload(
    submit,
    profileError,
    () =>
      sendJson("PATCH", "/api/v1/auth/profile", {
        displayName: field(data, "displayName"),
        // ADR-0109. Sent on EVERY profile save, including as an empty string —
        // which the endpoint normalises to `null`, i.e. "no byline". The
        // alternative (omitting it when empty) would make clearing a byline the
        // one thing this form cannot do, because absence means "unchanged".
        publicBylineName: field(data, "publicBylineName")
      }),
    (errorCode) =>
      errorCode === "VALIDATION_ERROR"
        ? message(
            "profileInvalid",
            "Enter a display name of 1 to 200 characters, and a byline of at most 120."
          )
        : message(
            "profileFailed",
            "Could not save your profile. Please try again."
          ),
    message("saving", "Saving…")
  );
});

// ------------------------------------------------------------ preferences --

onSubmit("account-preferences-form", async ({ submit }) => {
  await mutateAndReload(
    submit,
    preferencesError,
    () =>
      sendJson("POST", "/api/v1/auth/preferences", {
        locale: selectValueOrNull("account-locale"),
        theme: selectValueOrNull("account-theme"),
        timeZone: selectValueOrNull("account-time-zone")
      }),
    message(
      "preferencesFailed",
      "Could not save your preferences. Please try again."
    ),
    message("saving", "Saving…")
  );
});

/**
 * Selects the browser's own zone in the picker — it does not save.
 *
 * Two reasons it stops at selecting. The zone is a GUESS the browser makes from
 * the operating system, and a guess that silently persists is the class of
 * defect the old hard-coded UTC existed to avoid; and the reader can see what
 * was chosen and correct it before pressing Save, which is the difference
 * between a suggestion and a decision made on their behalf.
 *
 * If the detected zone is not among the server-rendered options — a browser
 * whose tzdata is ahead of the server's — the assignment is REFUSED by the
 * `<select>` and this reports it rather than leaving the control silently
 * unchanged, which would read as "the button is broken".
 */
onAction("#account-time-zone-detect", async (button) => {
  const select = document.getElementById("account-time-zone");

  if (!(select instanceof HTMLSelectElement)) return;

  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;

  preferencesError.clear();
  select.value = detected;

  if (select.value !== detected) {
    preferencesError.show(
      message(
        "timeZoneUnknown",
        "This browser reports a time zone this deployment does not know. Choose the closest one."
      )
    );
  }

  // `onAction` expects a promise; nothing here is asynchronous.
  await Promise.resolve(button);
});

// --------------------------------------------------------------- password --

onSubmit("account-password-form", async ({ data, submit }) => {
  await mutateAndReload(
    submit,
    passwordError,
    () =>
      sendJson("POST", "/api/v1/auth/password/change", {
        currentPassword: field(data, "currentPassword"),
        newPassword: field(data, "newPassword")
      }),
    (errorCode) => {
      // Surfaced specifically because the caller cannot otherwise tell which of
      // the two fields to fix, and this leaks nothing: they already hold the
      // session, and a wrong current password is a fact about what THEY typed.
      if (errorCode === "INVALID_CREDENTIALS") {
        return message(
          "passwordWrong",
          "Your current password is not correct."
        );
      }

      if (errorCode === "VALIDATION_ERROR" || errorCode === "WEAK_PASSWORD") {
        return message(
          "passwordWeak",
          "That new password does not meet the password policy."
        );
      }

      if (errorCode === "RATE_LIMITED") {
        return message(
          "rateLimited",
          "Too many attempts. Please wait a moment and try again."
        );
      }

      return message(
        "passwordFailed",
        "Could not change your password. Please try again."
      );
    },
    message("saving", "Saving…")
  );
});

// -------------------------------------------------------------------- MFA --

function show(id: string): void {
  const element = document.getElementById(id);
  if (element) element.hidden = false;
}

function renderRecoveryCodes(codes: readonly string[]): void {
  const list = document.getElementById("account-mfa-recovery-list");
  if (!list) return;

  list.replaceChildren(
    ...codes.map((code) => {
      const item = document.createElement("li");
      // `textContent`, never `innerHTML`: these come from the server, but an
      // element that accepts markup is one refactor away from accepting it from
      // somewhere else.
      item.textContent = code;
      return item;
    })
  );

  show("account-mfa-recovery");
}

onAction("#account-mfa-enrol", async (button) => {
  mfaError.clear();

  const result = await sendJsonForData<{ secret: string; otpauthUri: string }>(
    "POST",
    "/api/v1/auth/mfa/totp/enroll/start"
  );

  if (!result.ok || !result.data) {
    mfaError.show(
      result.errorCode === "MFA_ALREADY_ACTIVE"
        ? message(
            "mfaAlreadyActive",
            "Two-factor authentication is already switched on for your account."
          )
        : message("mfaStartFailed", "Could not start setup. Please try again.")
    );
    return;
  }

  const secret = document.getElementById("account-mfa-secret");
  if (secret) secret.textContent = result.data.secret;

  show("account-mfa-enrolment");
  button.hidden = true;
});

onSubmit("account-mfa-verify-form", async ({ data, submit }) => {
  // NOT `mutateAndReload`: verification returns the recovery codes, which are
  // shown EXACTLY ONCE and cannot be re-read. Reloading on success would
  // destroy them before the person could write them down — the same reasoning
  // `sendJsonForData`'s own comment gives for existing at all.
  mfaError.clear();

  if (submit) submit.disabled = true;

  const result = await sendJsonForData<{ recoveryCodes: string[] }>(
    "POST",
    "/api/v1/auth/mfa/totp/enroll/verify",
    { code: field(data, "code") }
  );

  if (submit) submit.disabled = false;

  if (!result.ok || !result.data) {
    mfaError.show(
      result.errorCode === "MFA_INVALID_CODE"
        ? message("mfaBadCode", "That code is not right. Try the next one.")
        : message(
            "mfaVerifyFailed",
            "Could not confirm the code. Please try again."
          )
    );
    return;
  }

  const form = document.getElementById("account-mfa-verify-form");
  if (form) form.hidden = true;

  renderRecoveryCodes(result.data.recoveryCodes);
});

/**
 * Both destructive MFA actions require a FRESH step-up
 * (`requireStepUp`) — turning off a second factor, or invalidating every
 * recovery code, must not be possible with a merely-stolen session.
 *
 * So `STEP_UP_REQUIRED` is not an error to report; it is a prompt. Asking for
 * the code and retrying once is what makes the control usable at all — without
 * it, the button would simply fail forever for anyone whose step-up window had
 * closed, which is nearly everyone.
 */
async function withStepUp(
  send: () => Promise<{ ok: boolean; errorCode: string | null }>
): Promise<{ ok: boolean; errorCode: string | null }> {
  const first = await send();

  if (first.ok || first.errorCode !== "STEP_UP_REQUIRED") return first;

  const code = window.prompt(
    message(
      "stepUpPrompt",
      "Enter the current six-digit code from your authenticator app to confirm."
    )
  );

  if (code === null || code.trim() === "") {
    return { ok: false, errorCode: "STEP_UP_CANCELLED" };
  }

  const stepUp = await sendJson("POST", "/api/v1/auth/mfa/step-up", {
    code: code.trim()
  });

  if (!stepUp.ok) return stepUp;

  return send();
}

onAction("#account-mfa-disable", async (button) => {
  await mutateAndReload(
    button,
    mfaError,
    () => withStepUp(() => sendJson("POST", "/api/v1/auth/mfa/totp/disable")),
    (errorCode) =>
      errorCode === "STEP_UP_CANCELLED"
        ? message(
            "stepUpCancelled",
            "Confirmation cancelled — nothing changed."
          )
        : message(
            "mfaDisableFailed",
            "Could not turn off two-factor authentication. Please try again."
          ),
    message("saving", "Saving…")
  );
});

onAction("#account-mfa-codes", async (button) => {
  // Again not `mutateAndReload`: the new codes are the whole point of the call
  // and a reload would discard them.
  mfaError.clear();
  button.disabled = true;

  let outcome: { ok: boolean; errorCode: string | null; data: unknown } = {
    ok: false,
    errorCode: null,
    data: null
  };

  await withStepUp(async () => {
    const result = await sendJsonForData<{ recoveryCodes: string[] }>(
      "POST",
      "/api/v1/auth/mfa/recovery-codes/regenerate"
    );
    outcome = result;
    return { ok: result.ok, errorCode: result.errorCode };
  });

  button.disabled = false;

  const data = outcome.data as { recoveryCodes: string[] } | null;

  if (!outcome.ok || !data) {
    mfaError.show(
      outcome.errorCode === "STEP_UP_CANCELLED"
        ? message(
            "stepUpCancelled",
            "Confirmation cancelled — nothing changed."
          )
        : message(
            "mfaCodesFailed",
            "Could not generate new recovery codes. Please try again."
          )
    );
    return;
  }

  renderRecoveryCodes(data.recoveryCodes);
});

// --------------------------------------------------------------- sessions --

onAction(".account-session-revoke", async (button) => {
  const sessionId = button.dataset.sessionId;
  if (!sessionId) return;

  await mutateAndReload(
    button,
    sessionsError,
    () =>
      sendJson(
        "DELETE",
        `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`
      ),
    message(
      "sessionRevokeFailed",
      "Could not sign that device out. Please try again."
    ),
    message("signingOut", "Signing out…")
  );
});

onAction("#account-sessions-revoke-all", async (button) => {
  await mutateAndReload(
    button,
    sessionsError,
    () => sendJson("POST", "/api/v1/auth/sessions/revoke-all"),
    message(
      "sessionRevokeAllFailed",
      "Could not sign your other devices out. Please try again."
    ),
    message("signingOut", "Signing out…")
  );
});

// -------------------------------------------------------------------- SSO --

onAction(".account-sso-link", async (button) => {
  const providerKey = button.dataset.providerKey;
  if (!providerKey) return;

  const ssoError = messageBox("account-sso-error");
  ssoError.clear();

  // NOT `mutateAndReload`: linking does not finish here. The endpoint answers
  // with an authorization URL and the browser has to LEAVE for the provider —
  // reloading this page instead would discard it and look like a no-op.
  const result = await sendJsonForData<{ authorizationUrl: string }>(
    "POST",
    `/api/v1/auth/sso/${encodeURIComponent(providerKey)}/link`
  );

  if (!result.ok || !result.data) {
    ssoError.show(
      message(
        "ssoLinkFailed",
        "Could not start connecting that provider. Please try again."
      )
    );
    return;
  }

  // `assign`, not `replace`: the account page should stay in history so a person
  // who abandons the provider's consent screen can come back with Back.
  window.location.assign(result.data.authorizationUrl);
});

onAction(".account-sso-unlink", async (button) => {
  const providerKey = button.dataset.providerKey;
  if (!providerKey) return;

  await mutateAndReload(
    button,
    messageBox("account-sso-error"),
    () =>
      sendJson(
        "POST",
        `/api/v1/auth/sso/${encodeURIComponent(providerKey)}/unlink`
      ),
    (errorCode) =>
      // Surfaced specifically: the server refuses to remove somebody's LAST way
      // of signing in, and a generic "could not disconnect" would leave them
      // retrying the one action it will never accept.
      errorCode === "LAST_SIGN_IN_METHOD" ||
      errorCode === "PASSWORD_LOGIN_DISABLED"
        ? message(
            "ssoLastMethod",
            "That is the only way you can sign in, so it cannot be disconnected. Set a password first."
          )
        : message(
            "ssoUnlinkFailed",
            "Could not disconnect that provider. Please try again."
          ),
    message("saving", "Saving…")
  );
});
