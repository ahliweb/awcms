/**
 * Client helpers the five `crm_leads` WRITE screens share (Issue #1166).
 *
 * Kept in one module so the screens' scripts share a chunk instead of each
 * shipping its own copy on the measured client budget.
 */

/** The sentences the server translated, read from the `data-messages` of `id`. */
export function readMessages(id: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(
      document.getElementById(id)?.dataset.messages ?? "{}"
    );

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/** The sentence for an API error code; an unknown or missing code shows the fallback. */
export function failureText(
  messages: Record<string, string>,
  errorCode: string | null
): string {
  return (
    (errorCode !== null ? messages[errorCode] : undefined) ??
    messages.fallback ??
    ""
  );
}

/**
 * An instant that is STABLE for one payload: a retry of the same request sends
 * the same `occurredAt`, so it replays under its `Idempotency-Key` instead of
 * colliding with it (the endpoints hash the body, and the server default for a
 * missing `occurredAt` is "now", which differs on every attempt). A different
 * payload gets a fresh instant.
 */
export function createInstantSource(): (payload: unknown) => string {
  let lastBody: string | null = null;
  let lastInstant = "";

  return (payload) => {
    const body = JSON.stringify(payload ?? null);

    if (body !== lastBody) {
      lastBody = body;
      lastInstant = new Date().toISOString();
    }

    return lastInstant;
  };
}
