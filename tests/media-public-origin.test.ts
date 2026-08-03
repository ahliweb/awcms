/**
 * `deriveMediaPublicOrigin` — what a build client is told to put in `img-src`.
 *
 * The cases that matter are the ones where being WRONG is silent. A malformed
 * origin echoed back lands in a consumer's Content-Security-Policy header,
 * where a browser either rejects the whole policy — taking every other
 * directive with it — or accepts something nobody wrote down. Neither failure
 * points at this function.
 *
 * Pure — no database, no network, no environment.
 */
import { describe, expect, test } from "bun:test";

import { deriveMediaPublicOrigin } from "../src/modules/media-library/domain/media-public-origin";

describe("deriveMediaPublicOrigin", () => {
  test("reports the origin and the trimmed base for a configured host", () => {
    expect(deriveMediaPublicOrigin("https://media.example.com/news")).toEqual({
      configured: true,
      origin: "https://media.example.com",
      baseUrl: "https://media.example.com/news"
    });
  });

  test("origin excludes the path, because CSP host-sources are not paths", () => {
    // The whole reason both values are returned: a consumer choosing the
    // host-wide form must not accidentally paste a path into it.
    const result = deriveMediaPublicOrigin("https://cdn.example.com/a/b/c");

    expect(result.origin).toBe("https://cdn.example.com");
    expect(result.baseUrl).toBe("https://cdn.example.com/a/b/c");
  });

  test("keeps a non-default port, which is part of the origin", () => {
    // Dropping it would produce a policy that allows a host the deployment
    // does not serve from, and blocks the one it does.
    expect(deriveMediaPublicOrigin("http://localhost:9000/media").origin).toBe(
      "http://localhost:9000"
    );
  });

  test("strips exactly one trailing slash from the base URL", () => {
    expect(deriveMediaPublicOrigin("https://media.example.com/news/")).toEqual({
      configured: true,
      origin: "https://media.example.com",
      baseUrl: "https://media.example.com/news"
    });
  });

  test("an unset value is `configured: false`, not an error", () => {
    // LAN/offline profiles serve no public media. A build client must be able
    // to tell that apart from a failed request.
    for (const value of ["", "   "]) {
      expect(deriveMediaPublicOrigin(value)).toEqual({
        configured: false,
        origin: null,
        baseUrl: null
      });
    }
  });

  test("a set-but-unparseable value is reported as unconfigured, never echoed", () => {
    // Echoing it back is the dangerous option: it reaches a CSP header.
    for (const value of ["media.example.com", "://nope", "not a url"]) {
      expect(deriveMediaPublicOrigin(value)).toEqual({
        configured: false,
        origin: null,
        baseUrl: null
      });
    }
  });

  test("rejects schemes that cannot serve media over the network", () => {
    // `data:` and `file:` mean something entirely different inside `img-src`;
    // `data:` in particular re-opens an injection surface a strict policy
    // exists to close.
    for (const value of [
      "data:image/png;base64,AAAA",
      "file:///srv/media",
      "ftp://media.example.com"
    ]) {
      expect(deriveMediaPublicOrigin(value).configured).toBe(false);
    }
  });
});
