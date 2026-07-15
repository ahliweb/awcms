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

/** Never pass the caught error's own message through — only ever this fixed, generic string. */
export function serverErrorHtmlResponse(): Response {
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

export function serverErrorXmlResponse(): Response {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><error>Internal Server Error</error>',
    {
      status: 500,
      headers: { "content-type": "application/xml; charset=utf-8" }
    }
  );
}
