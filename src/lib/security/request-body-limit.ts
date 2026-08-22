import { fail } from "../../modules/_shared/api-response";

export type BodySizeTier = "default" | "large";

export const BODY_SIZE_TIER_BYTES: Record<BodySizeTier, number> = {
  default: 128 * 1024,
  large: 5 * 1024 * 1024
};

/** No tier may exceed this without an explicit, reviewed change. */
export const BODY_SIZE_HARD_CEILING_BYTES = 10 * 1024 * 1024;

export type BodyReadResult<T> =
  { tooLarge: false; value: T } | { tooLarge: true; limitBytes: number };

/**
 * What `readJsonBody` answers, with the one distinction its caller usually needs
 * and the plain `BodyReadResult` cannot express.
 *
 * `value: null` means the body was EMPTY. `malformed: true` means bytes arrived
 * and were not JSON. Collapsing those two into one `null` — which this function
 * used to do — turns a route's "Request body must be valid JSON" 400 into a
 * field-validation 400 with a different sentence, or into a silent accept for a
 * route where an empty body is legitimate. Both are wrong answers to a question
 * the caller is entitled to ask.
 */
export type JsonBodyReadResult<T> =
  | { tooLarge: false; malformed: false; value: T | null }
  | { tooLarge: false; malformed: true; value: null }
  | { tooLarge: true; limitBytes: number };

function resolveLimitBytes(tier: BodySizeTier): number {
  return BODY_SIZE_TIER_BYTES[tier];
}

function parseDeclaredLength(request: Request): number | null {
  const header = request.headers.get("content-length");

  if (header === null) {
    return null;
  }

  const parsed = Number(header);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readCappedText(
  request: Request,
  limitBytes: number
): Promise<{ tooLarge: false; text: string } | { tooLarge: true }> {
  const declaredLength = parseDeclaredLength(request);

  if (declaredLength !== null && declaredLength > limitBytes) {
    return { tooLarge: true };
  }

  const body = request.body;

  if (!body) {
    return { tooLarge: false, text: "" };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    total += value.byteLength;

    if (total > limitBytes) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }

    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { tooLarge: false, text: new TextDecoder().decode(combined) };
}

export async function readJsonBody<T = unknown>(
  request: Request,
  tier: BodySizeTier = "default"
): Promise<JsonBodyReadResult<T>> {
  const limitBytes = resolveLimitBytes(tier);
  const textResult = await readCappedText(request, limitBytes);

  if (textResult.tooLarge) {
    return { tooLarge: true, limitBytes };
  }

  if (textResult.text.length === 0) {
    return { tooLarge: false, malformed: false, value: null };
  }

  try {
    return {
      tooLarge: false,
      malformed: false,
      value: JSON.parse(textResult.text) as T
    };
  } catch {
    return { tooLarge: false, malformed: true, value: null };
  }
}

/**
 * Capped replacement for `await request.formData()` on
 * `application/x-www-form-urlencoded` — the only content type the routes in this
 * repo reach `formData()` for (each branches on the header first).
 *
 * `URLSearchParams` rather than `FormData`, and the difference is worth naming:
 * `request.formData()` reads the whole body before it returns anything, with no
 * bound, which is the defect. Reading capped text and parsing it gives the same
 * `.get(name)` surface with a ceiling in front of it.
 *
 * NOT a substitute for `multipart/form-data`: a multipart body parsed this way
 * yields nothing rather than failing loudly. No route here sends one — file
 * upload goes direct to R2 through a presigned session — and a route that starts
 * to needs a real parser, not this.
 */
export async function readFormBody(
  request: Request,
  tier: BodySizeTier = "default"
): Promise<BodyReadResult<URLSearchParams>> {
  const limitBytes = resolveLimitBytes(tier);
  const textResult = await readCappedText(request, limitBytes);

  if (textResult.tooLarge) {
    return { tooLarge: true, limitBytes };
  }

  return { tooLarge: false, value: new URLSearchParams(textResult.text) };
}

/** Drop-in replacement for `await request.text()`, capped at `tier`'s limit. */
export async function readTextBody(
  request: Request,
  tier: BodySizeTier = "default"
): Promise<BodyReadResult<string>> {
  const limitBytes = resolveLimitBytes(tier);
  const textResult = await readCappedText(request, limitBytes);

  if (textResult.tooLarge) {
    return { tooLarge: true, limitBytes };
  }

  return { tooLarge: false, value: textResult.text };
}

export function bodyTooLargeResponse(limitBytes: number): Response {
  return fail(
    413,
    "PAYLOAD_TOO_LARGE",
    `Request body exceeds the maximum allowed size of ${limitBytes} bytes.`,
    {},
    undefined,
    { connection: "close" }
  );
}

/** Cheap global-only pre-check for `src/middleware.ts` — defense-in-depth, not the primary enforcement (see `readJsonBody`). */
export function checkContentLengthCeiling(request: Request): boolean {
  const declaredLength = parseDeclaredLength(request);

  return (
    declaredLength === null || declaredLength <= BODY_SIZE_HARD_CEILING_BYTES
  );
}
