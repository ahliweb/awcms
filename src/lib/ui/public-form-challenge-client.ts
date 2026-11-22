/**
 * Client half of the public-form challenge seam (Issue #1353). Server half:
 * `src/lib/security/public-form-challenge.ts`.
 *
 * Imported by a page's `<script>` so it is BUNDLED: Astro inlines a script with
 * no `import`, and this app's CSP blocks inline scripts (see
 * `admin-form-client.ts`).
 *
 * The field contract: whatever widget a provider renders writes its output to
 * form fields named `challengeId`, `challengeAnswer` and `challengeToken`
 * (hidden inputs are fine), and the widget's container carries
 * `data-challenge-widget`. Cloudflare Turnstile writes `cf-turnstile-response`
 * instead, which is read as `challengeToken` here (the server also still accepts
 * the older `turnstileToken` field).
 *
 * No widget is rendered here: rendering is provider-specific (a script from the
 * provider's origin, or a self-hosted prompt), so it stays with the page that
 * enables that provider. With no widget on the page, `readChallengeFields`
 * returns `{}`, so the body is byte-for-byte what it was before the seam.
 */

export const CHALLENGE_WIDGET_SELECTOR = "[data-challenge-widget]";

export type ChallengeBodyFields = {
  challengeId?: string;
  challengeAnswer?: string;
  challengeToken?: string;
};

/** Longest value forwarded; the server refuses longer, so do not send what is certain to be refused. */
const MAX_FIELD_LENGTH = 4_096;

function field(data: FormData, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = data.get(name);

    if (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_FIELD_LENGTH
    ) {
      return value;
    }
  }

  return undefined;
}

/** The challenge fields of a submitted form, ready to spread into the JSON body: `{ ...readChallengeFields(formData) }`. Absent fields are omitted. */
export function readChallengeFields(data: FormData): ChallengeBodyFields {
  const challengeId = field(data, "challengeId");
  const challengeAnswer = field(data, "challengeAnswer");
  const challengeToken = field(data, "challengeToken", "cf-turnstile-response");

  return {
    ...(challengeId ? { challengeId } : {}),
    ...(challengeAnswer ? { challengeAnswer } : {}),
    ...(challengeToken ? { challengeToken } : {})
  };
}

/** Error codes that mean "the challenge was missing or refused": the platform's neutral pair and Turnstile's published pair. */
export function isChallengeRefusalCode(code: unknown): boolean {
  return (
    code === "CHALLENGE_REQUIRED" ||
    code === "CHALLENGE_INVALID" ||
    code === "TURNSTILE_REQUIRED" ||
    code === "TURNSTILE_INVALID"
  );
}

/**
 * Hands focus back to the form's challenge widget after a refusal. Returns true
 * when a widget was found and focused. A widget that is not itself focusable
 * gets `tabindex="-1"` so focus can land on it.
 */
export function focusChallengeWidget(root: ParentNode): boolean {
  const widget = root.querySelector<HTMLElement>(CHALLENGE_WIDGET_SELECTOR);

  if (!widget) {
    return false;
  }

  if (!widget.hasAttribute("tabindex")) {
    widget.setAttribute("tabindex", "-1");
  }

  widget.focus();
  return true;
}

/**
 * `focusChallengeWidget` when the parsed response body carries a challenge
 * refusal code; otherwise does nothing. It takes the whole body so a page script
 * never reads a field of it itself (the auth pages read nothing but `success`:
 * `tests/auth-page-locale.test.ts`).
 */
export function focusChallengeOnRefusal(
  root: ParentNode,
  responseBody: unknown
): boolean {
  const code = (
    responseBody as { error?: { code?: unknown } } | null | undefined
  )?.error?.code;

  return isChallengeRefusalCode(code) ? focusChallengeWidget(root) : false;
}
