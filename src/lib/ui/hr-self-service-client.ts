/**
 * The shared client half of the HR self-service screens (Issue #952).
 *
 * Every mutation carries an `Idempotency-Key` drawn from the repo's
 * `createIdempotencyKeySource` (the same request pressed again after a lost
 * response replays the stored response; an edited request draws a new key), and
 * a double click is stopped by `lockElement`. The page renders its translated
 * messages as JSON in `data-msgs` on `#hr-messages`, keyed by the API's error
 * code, so no English literal lives in the script.
 *
 * Importing from `admin-form-client` is what makes Astro bundle the page script
 * as an external file the CSP permits (see that module).
 */
import { createIdempotencyKeySource } from "./admin-idempotency-key";
import {
  messageBox,
  mutateAndReload,
  sendJson,
  type MessageBox
} from "./admin-form-client";

export type Messages = Record<string, string>;

export function readMessages(): Messages {
  const host = document.getElementById("hr-messages");

  try {
    return JSON.parse(host?.dataset.msgs ?? "{}") as Messages;
  } catch {
    return {};
  }
}

const keyFor = createIdempotencyKeySource();

/** Lock the control, send with an `Idempotency-Key`, reload on success, else show the message of the error code. */
export function hrMutate(
  button: HTMLButtonElement | null,
  box: MessageBox,
  messages: Messages,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown
): Promise<void> {
  return mutateAndReload(
    button,
    box,
    () =>
      sendJson(method, url, body, {
        "Idempotency-Key": keyFor({ method, url, body })
      }),
    (code) => messages[code ?? ""] ?? messages.generic ?? "",
    messages.busy ?? "…"
  );
}

export { messageBox };
