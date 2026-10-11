/**
 * The one outbound HTTP seam for WhatsApp adapters (Issue #963). Every network
 * call goes through `ssrfSafeFetch`, never bare `fetch`: the destination is a
 * deployment-configured URL and the worker holds a database connection.
 *
 * The seam is a TYPE so tests drive an adapter without network access and
 * without defeating the guard (a test that had to would test a different path
 * than production runs). The timeout is TOTAL wall-clock including the body
 * read, which is the `withTimeout` bound ADR-0133 section 5.3 asks for.
 */
import { ssrfSafeFetch } from "../../../lib/auth/ssrf-guard";

export type WhatsappHttpRequest = {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
};

export type WhatsappHttpResult =
  { ok: true; status: number; body: string } | { ok: false; reason: string };

export type WhatsappHttpClient = (
  url: string,
  request: WhatsappHttpRequest
) => Promise<WhatsappHttpResult>;

const MAX_RESPONSE_BYTES = 64 * 1024;

/** A non-2xx is a RESPONSE (adapters map it); only a guard denial or network error is `ok: false`. */
export const defaultWhatsappHttpClient: WhatsappHttpClient = async (
  url,
  request
) => {
  const result = await ssrfSafeFetch(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    timeoutMs: request.timeoutMs,
    maxResponseBytes: MAX_RESPONSE_BYTES
  });

  if (!result.ok) {
    return { ok: false, reason: `outbound request refused: ${result.reason}` };
  }

  return {
    ok: true,
    status: result.response.status,
    body: await result.response.text()
  };
};

/**
 * Provider replies can echo the recipient. Error text is stored, logged and
 * shown on the admin screen, so any run of 7+ digits is replaced first.
 */
export function scrubProviderText(text: string, maxLength = 300): string {
  return text.replace(/\+?\d[\d\s-]{5,}\d/g, "[number]").slice(0, maxLength);
}
