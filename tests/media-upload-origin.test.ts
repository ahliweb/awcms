/**
 * `deriveMediaUploadOrigin` (Issue #595) — the origin a browser `PUT`s upload
 * bytes to, which a Content-Security-Policy has to name in `connect-src`.
 *
 * Pure function, no environment read: every case passes its inputs.
 *
 * The cases that matter are the degradations. A CSP source built from a
 * malformed value is worse than none at all, because a rejected policy takes
 * every other directive down with it — so anything that cannot be a host must
 * report "unconfigured", never a guess.
 */
import { describe, expect, test } from "bun:test";

import { deriveMediaUploadOrigin } from "../src/modules/media-library/domain/media-upload-origin";

describe("deriveMediaUploadOrigin", () => {
  test("builds R2's S3 API endpoint from the account id", () => {
    expect(deriveMediaUploadOrigin("abc123")).toEqual({
      configured: true,
      origin: "https://abc123.r2.cloudflarestorage.com"
    });
  });

  test("reports unconfigured for an empty account id — the LAN/offline state", () => {
    expect(deriveMediaUploadOrigin("")).toEqual({
      configured: false,
      origin: null
    });
    expect(deriveMediaUploadOrigin("   ")).toEqual({
      configured: false,
      origin: null
    });
  });

  test("refuses an account id that could not be a host label", () => {
    // These would each produce a DIFFERENT host than intended, or an invalid
    // one — and a CSP source list is the wrong place to find that out.
    for (const bad of [
      "has space",
      "has/slash",
      "has.dot",
      "has_underscore",
      "has:colon",
      "*"
    ]) {
      expect(deriveMediaUploadOrigin(bad)).toEqual({
        configured: false,
        origin: null
      });
    }
  });

  test("an endpoint override wins, so a local fake S3 server is not blocked", () => {
    expect(deriveMediaUploadOrigin("abc123", "http://127.0.0.1:9000")).toEqual({
      configured: true,
      origin: "http://127.0.0.1:9000"
    });
  });

  test("an override reduces to a bare ORIGIN — path, query and fragment are dropped", () => {
    // A CSP host-source is scheme+host+port. Echoing a path back would emit a
    // path-scoped source, which is a different (and redirect-fragile) policy
    // than the caller asked for.
    expect(
      deriveMediaUploadOrigin("", "https://fake.test:8443/bucket?x=1#y").origin
    ).toBe("https://fake.test:8443");
  });

  test("keeps a non-default port, which is part of the origin", () => {
    expect(deriveMediaUploadOrigin("", "https://fake.test:8443").origin).toBe(
      "https://fake.test:8443"
    );
  });

  test("refuses a non-http(s) override rather than echoing it", () => {
    // `file:`/`data:` mean something entirely different in a CSP source list.
    for (const bad of ["file:///tmp/x", "data:text/plain,x", "ftp://h/x"]) {
      expect(deriveMediaUploadOrigin("", bad)).toEqual({
        configured: false,
        origin: null
      });
    }
  });

  test("refuses an unparseable override rather than echoing it", () => {
    expect(deriveMediaUploadOrigin("", "not a url")).toEqual({
      configured: false,
      origin: null
    });
  });

  test("an override that is only whitespace falls back to the account id", () => {
    // Otherwise a stray blank in config would silently disable uploads on a
    // deployment whose account id is perfectly valid.
    expect(deriveMediaUploadOrigin("abc123", "   ").origin).toBe(
      "https://abc123.r2.cloudflarestorage.com"
    );
  });
});
