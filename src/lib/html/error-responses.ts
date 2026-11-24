import { escapeHtml } from "./escape";

/**
 * Minimal public-facing HTML error responses (Issue #540: "Error output
 * must not expose stack traces"). Reusable beyond `blog_content` — any
 * future public (non-JSON, non-admin) route can reuse these instead of
 * hand-rolling its own error page or, worse, letting an uncaught
 * exception's message/stack leak into the response.
 */
function errorPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body>
</html>`;
}

export function notFoundHtmlResponse(): Response {
  return new Response(
    errorPage("Not Found", "The page you requested does not exist."),
    {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" }
    }
  );
}

/**
 * Issue #1454 — a database-gate refusal (`DatabaseBusyError`: circuit breaker
 * open, or the work class's bounded queue full) is load shedding, not a bug.
 * It used to surface on the public routes as a generic 500, which tells a CDN
 * and a crawler "broken" instead of "retry shortly". Detected structurally
 * (`code === "DATABASE_BUSY"`) so this module does not import the database
 * layer.
 */
export function readDatabaseBusyRetryAfter(error: unknown): number | null {
  if (
    error instanceof Error &&
    (error as { code?: unknown }).code === "DATABASE_BUSY"
  ) {
    const raw = Number(
      (error as { retryAfterSeconds?: unknown }).retryAfterSeconds
    );

    return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 300) : 1;
  }

  return null;
}

function busyHeaders(contentType: string, retryAfter: number): HeadersInit {
  return {
    "content-type": contentType,
    "retry-after": String(retryAfter),
    "cache-control": "no-store"
  };
}

/**
 * Never pass the caught error's own message through — only ever this fixed,
 * generic string. Pass the caught `error` so a database refusal answers
 * `503` + `Retry-After` instead of `500`.
 */
export function serverErrorHtmlResponse(error?: unknown): Response {
  const retryAfter = readDatabaseBusyRetryAfter(error);

  if (retryAfter !== null) {
    return new Response(
      errorPage(
        "Temporarily Unavailable",
        "The service is busy. Please try again shortly."
      ),
      {
        status: 503,
        headers: busyHeaders("text/html; charset=utf-8", retryAfter)
      }
    );
  }

  return new Response(
    errorPage(
      "Something Went Wrong",
      "An unexpected error occurred. Please try again later."
    ),
    {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" }
    }
  );
}

export function notFoundXmlResponse(): Response {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><error>Not Found</error>',
    {
      status: 404,
      headers: { "content-type": "application/xml; charset=utf-8" }
    }
  );
}

export function serverErrorXmlResponse(error?: unknown): Response {
  const retryAfter = readDatabaseBusyRetryAfter(error);

  if (retryAfter !== null) {
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><error>Service Unavailable</error>',
      {
        status: 503,
        headers: busyHeaders("application/xml; charset=utf-8", retryAfter)
      }
    );
  }

  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><error>Internal Server Error</error>',
    {
      status: 500,
      headers: { "content-type": "application/xml; charset=utf-8" }
    }
  );
}

/**
 * `text/plain` error variants for the public discovery surfaces whose success
 * body is not HTML/XML (`/robots.txt`, `/feed.json`) — ADR-0038 seo_distribution.
 * A fixed generic string only; the caught error's own message/stack is never
 * passed through (same Issue #540 discipline as the HTML/XML variants).
 */
export function notFoundTextResponse(): Response {
  return new Response("Not Found\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

export function serverErrorTextResponse(): Response {
  return new Response("Internal Server Error\n", {
    status: 500,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}
