/**
 * The shared client half of the booking admin screens (Issue #942).
 *
 * ## What it adds to `admin-form-client`
 *
 *   * Every mutation carries an `Idempotency-Key` (`bookingSend`), drawn from the
 *     repo's `createIdempotencyKeySource` (`admin-idempotency-key.ts`, the one
 *     inventory, tax and procurement use) and keyed on method + url + body: the
 *     SAME request pressed again after a lost response replays the stored
 *     response instead of repeating, and an edited request draws a new key. A
 *     double click is stopped by `lockElement`. The memory is per page load: a
 *     manual reload after a lost response draws a fresh key, and a create-style
 *     route then answers `CODE_TAKEN` / `BLOCK_CONFLICT` truthfully, because the
 *     first attempt did succeed. Delete, restore, release and the reservation
 *     transitions additionally replay by STATE.
 *   * Translated messages. The page renders its strings, translated on the
 *     server, as JSON in `data-msgs` on `#booking-messages`; the script picks the
 *     message of the API's error code, else `generic`. No English literal lives
 *     in the script, so the Indonesian reader gets Indonesian errors.
 *
 * Importing from `admin-form-client` is what makes Astro bundle the page script
 * as an external file the CSP permits (see that module).
 */
import { createIdempotencyKeySource } from "./admin-idempotency-key";
import { buildBody, type FieldSpec } from "../booking-admin-format";
import {
  messageBox,
  mutateAndReload,
  sendJson,
  type MessageBox
} from "./admin-form-client";

export type Messages = Record<string, string>;

/** The server-rendered, translated messages of this page. */
export function readMessages(): Messages {
  const host = document.getElementById("booking-messages");

  try {
    return JSON.parse(host?.dataset.msgs ?? "{}") as Messages;
  } catch {
    return {};
  }
}

const keyFor = createIdempotencyKeySource();

export function bookingSend(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown
) {
  return sendJson(method, url, body, {
    "Idempotency-Key": keyFor({ method, url, body })
  });
}

/** Lock the control, send with an `Idempotency-Key`, reload on success, else show the message of the error code. */
export function bookingMutate(
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
    () => bookingSend(method, url, body),
    (code) => messages[code ?? ""] ?? messages.generic ?? "",
    messages.busy ?? "…"
  );
}

export { messageBox };

/** A form control and how to turn its text into the API value. */
export type FormField = {
  id: string;
  key: string;
  convert: (raw: string) => unknown;
};

/**
 * Reads the controls into a request body (see `booking-admin-format.ts` for the
 * rule): an unedited control sends the API value it was rendered from, an edited
 * one is converted; `onlyChanged` leaves unedited ones out (a `PATCH`).
 */
export function collectBody(
  fields: readonly FormField[],
  options: { onlyChanged: boolean }
): Record<string, unknown> {
  const specs: FieldSpec[] = fields.map((field) => {
    const element = document.getElementById(field.id) as
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    const raw = element?.value ?? "";

    return {
      key: field.key,
      raw,
      initial: element?.dataset.initial ?? raw,
      original: JSON.parse(element?.dataset.original ?? "null") as unknown,
      convert: field.convert
    };
  });

  return buildBody(specs, options);
}
