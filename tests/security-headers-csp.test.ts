/**
 * Issue #148 — Content-Security-Policy. `buildSecurityHeaders` is a function of
 * its options (`src/middleware.ts` is what applies the result to every
 * response), so these are ordinary unit tests: no database, no build, no
 * browser. Its ONE environment read is `mediaPublicBaseUrl`'s default, which is
 * why every case below passes that option explicitly and the two that exercise
 * the default set and restore the variable themselves.
 *
 * This header used to argue that a browser-level check of the kind awcms-mini
 * needed (headless Chrome, to catch inline scripts Astro's own hashing missed)
 * had no subject here, because "this base ships no `.astro` component, no
 * inline script/style, and no external origin". That stopped being true, and
 * believing it is how the missing `img-src` survived: the base now renders
 * dozens of `.astro` pages, and those pages load images from the R2 media
 * origin, which `default-src 'self'` blocked without emitting a single error
 * anywhere the server could see. What is still true is that a browser is not
 * needed to catch THAT class of defect — a missing directive is visible in the
 * header string, which is what the assertions below read. What a browser would
 * add is the other direction (a page loading something the policy forbids),
 * and `tests/e2e` is where that belongs.
 *
 * See `src/lib/security/security-headers.ts`'s header for the full argument.
 */
import { describe, expect, test } from "bun:test";

import { buildSecurityHeaders } from "../src/lib/security/security-headers";
import { THEME_INIT_SCRIPT_HASH } from "../src/lib/security/theme-init-script";
import {
  VIDEO_EMBED_ORIGIN,
  isVideoEmbedEnabled
} from "../src/lib/security/video-embed";

/**
 * `mediaPublicBaseUrl` is passed EXPLICITLY (default `""` — the unconfigured
 * state) by every case below. Omitting it is a real code path, but it reads
 * `NEWS_MEDIA_R2_PUBLIC_BASE_URL` from the ambient environment, and a suite
 * whose exact-policy assertions depend on the developer's `.env` fails for a
 * reason that has nothing to do with the policy. The default path gets its own
 * test, which sets and restores that variable itself.
 */
function cspFor(
  isProduction: boolean,
  turnstileEnabled = false,
  mediaPublicBaseUrl = "",
  mediaUploadAccountId = "",
  videoEmbedEnabled = false
): string {
  const header = buildSecurityHeaders({
    isProduction,
    turnstileEnabled,
    mediaPublicBaseUrl,
    mediaUploadAccountId,
    videoEmbedEnabled
  }).find(([name]) => name === "Content-Security-Policy");

  if (!header) {
    throw new Error("Content-Security-Policy header was not emitted at all.");
  }

  return header[1];
}

function directives(
  isProduction = false,
  turnstileEnabled = false,
  mediaPublicBaseUrl = "",
  mediaUploadAccountId = "",
  videoEmbedEnabled = false
): string[] {
  return cspFor(
    isProduction,
    turnstileEnabled,
    mediaPublicBaseUrl,
    mediaUploadAccountId,
    videoEmbedEnabled
  )
    .split(";")
    .map((directive) => directive.trim());
}

describe("buildSecurityHeaders — Content-Security-Policy (Issue #148)", () => {
  test("emits a Content-Security-Policy header", () => {
    expect(
      buildSecurityHeaders({ isProduction: false }).map(([name]) => name)
    ).toContain("Content-Security-Policy");
  });

  test("carries every directive ported from awcms-mini's own policy, plus the always-on script-src, img-src, media-src and connect-src", () => {
    expect(directives()).toEqual([
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      `script-src 'self' '${THEME_INIT_SCRIPT_HASH}'`,
      "img-src 'self' data:",
      "media-src 'self'",
      "connect-src 'self'"
    ]);
  });

  test("is identical in production and non-production — CSP is not a TLS-gated header like HSTS is", () => {
    expect(cspFor(true)).toBe(cspFor(false));
  });

  test("never weakens script/style with 'unsafe-inline' or 'unsafe-eval' — this base has no inline script or style to accommodate", () => {
    const policy = cspFor(true);

    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
  });

  test("with Turnstile disabled (the default / every LAN-offline deployment) no third-party origin is allowlisted", () => {
    const policy = cspFor(true, false);

    expect(policy).not.toContain("challenges.cloudflare.com");
    expect(policy).not.toContain("youtube-nocookie.com");
    expect(policy).not.toMatch(/https?:\/\//);
    // `frame-src` still appears only for Turnstile. `script-src` IS present
    // now (the admin theme-init hash lives there) but names nothing beyond
    // `'self'` and that one self-authored hash — no origin, third-party or
    // otherwise, is reachable through it. `img-src` is present for the same
    // kind of reason and, with no media origin configured (this call passes
    // the unconfigured `""`), names no origin either.
    expect(policy).not.toContain("frame-src");
    expect(policy).toContain(`script-src 'self' '${THEME_INIT_SCRIPT_HASH}'`);
    expect(policy).toContain("img-src 'self' data:");
    expect(policy).toContain("media-src 'self'");
  });

  test("keeps X-Frame-Options: DENY alongside frame-ancestors 'none' as an independent older-browser layer", () => {
    const headers = buildSecurityHeaders({ isProduction: true });

    expect(headers).toContainEqual(["X-Frame-Options", "DENY"]);
    expect(cspFor(true)).toContain("frame-ancestors 'none'");
  });

  test("leaves the pre-existing headers untouched (CSP is additive, Issue #148 is config-only in spirit)", () => {
    const names = buildSecurityHeaders({ isProduction: true }).map(
      ([name]) => name
    );

    expect(names).toContain("X-Content-Type-Options");
    expect(names).toContain("Referrer-Policy");
    expect(names).toContain("Permissions-Policy");
    expect(names).toContain("Strict-Transport-Security");
  });

  test("still gates Strict-Transport-Security on production only", () => {
    const names = buildSecurityHeaders({ isProduction: false }).map(
      ([name]) => name
    );

    expect(names).not.toContain("Strict-Transport-Security");
    expect(names).toContain("Content-Security-Policy");
  });
});

/**
 * Cross-origin isolation (assessment of 4 August 2026 §9.2).
 *
 * These two are OWASP Secure Headers Project "recommended", and this repo is
 * the family member they actually apply to: it has human sessions and 42
 * rendered pages, where `awcms-astro` is a static template whose ADR-0028 §D
 * declines CORP for a reason that does not transfer (it would decide image
 * embedding on behalf of sites that do not exist yet).
 *
 * The assertions below are deliberately NOT "the header is present". They pin
 * the two properties that make them worth having and would be lost first by an
 * innocent-looking edit: the VALUES (a weaker `unsafe-none`/`cross-origin`
 * would still be a header), and that they are NOT gated on production the way
 * HSTS is (an attacker does not wait for TLS, and staging carries the same
 * admin session shape as production).
 */
describe("buildSecurityHeaders — cross-origin isolation (§9.2)", () => {
  const valueOf = (name: string, isProduction: boolean): string | undefined =>
    buildSecurityHeaders({ isProduction }).find(
      ([header]) => header === name
    )?.[1];

  test("sends Cross-Origin-Opener-Policy: same-origin, severing the opener tie to an authenticated admin window", () => {
    expect(valueOf("Cross-Origin-Opener-Policy", true)).toBe("same-origin");
  });

  test("sends Cross-Origin-Resource-Policy: same-origin, closing the no-cors embedding path CORS alone leaves open", () => {
    expect(valueOf("Cross-Origin-Resource-Policy", true)).toBe("same-origin");
  });

  test("both are unconditional — unlike HSTS they are NOT a TLS-gated header", () => {
    expect(valueOf("Cross-Origin-Opener-Policy", false)).toBe("same-origin");
    expect(valueOf("Cross-Origin-Resource-Policy", false)).toBe("same-origin");
  });

  test("adding them did not disturb the CSP single-owner guarantee", () => {
    // The whole point of §9.2 was that these are additive. If a future edit
    // reaches for `unsafe-none` to make some popup flow work, this file should
    // fail before the popup does.
    const enabled = buildSecurityHeaders({
      isProduction: true,
      turnstileEnabled: true
    });
    const disabled = buildSecurityHeaders({ isProduction: true });

    for (const headers of [enabled, disabled]) {
      const csp = headers.find(([name]) => name === "Content-Security-Policy");

      expect(csp?.[1]).toContain("default-src 'self'");
      expect(csp?.[1]).not.toContain("unsafe-inline");
    }

    expect(enabled.map(([name]) => name)).toEqual(
      disabled.map(([name]) => name)
    );
  });
});

describe("buildSecurityHeaders — Turnstile CSP origin (Issue #186)", () => {
  const CF = "https://challenges.cloudflare.com";

  test("opens EXACTLY the one Cloudflare origin in script-src and frame-src when enabled", () => {
    const list = directives(true, true);

    expect(list).toContain(
      `script-src 'self' '${THEME_INIT_SCRIPT_HASH}' ${CF}`
    );
    expect(list).toContain(`frame-src ${CF}`);
    // The Turnstile origin is the ONLY third-party origin — narrow, as required.
    const policy = cspFor(true, true);
    const origins = policy.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(new Set(origins)).toEqual(new Set([CF]));
  });

  test("re-states 'self' in script-src so the bundled login client still loads once script-src is present", () => {
    expect(cspFor(true, true)).toContain(
      `script-src 'self' '${THEME_INIT_SCRIPT_HASH}' ${CF}`
    );
    // ...and with Turnstile off too, since script-src is unconditional now.
    expect(cspFor(true, false)).toContain("script-src 'self'");
  });

  test("keeps every base directive unchanged when enabled (origin is purely additive)", () => {
    const list = directives(false, true);

    for (const base of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ]) {
      expect(list).toContain(base);
    }
  });

  test("enabled vs disabled differ ONLY by the Turnstile origin — proof it never leaks into the LAN/offline policy", () => {
    const disabled = directives(true, false);
    const enabled = directives(true, true);
    const added = enabled.filter((d) => !disabled.includes(d));

    // `script-src` now exists in BOTH; enabling Turnstile appends its origin to
    // the existing directive rather than introducing the directive. So the
    // delta is the rewritten script-src plus the new frame-src — and the ONLY
    // textual difference between the two script-src values is the appended
    // origin, which is what this test really guards.
    expect(added).toEqual([
      `script-src 'self' '${THEME_INIT_SCRIPT_HASH}' ${CF}`,
      `frame-src ${CF}`
    ]);

    const scriptSrcDisabled = disabled.find((d) => d.startsWith("script-src"));
    const scriptSrcEnabled = enabled.find((d) => d.startsWith("script-src"));
    expect(scriptSrcEnabled).toBe(`${scriptSrcDisabled} ${CF}`);

    // Every non-script-src directive survives enabling untouched.
    expect(
      disabled
        .filter((d) => !d.startsWith("script-src"))
        .every((d) => enabled.includes(d))
    ).toBe(true);
  });
});

/**
 * `img-src` and the R2 media origin.
 *
 * The defect this pins was invisible from inside the app: `default-src 'self'`
 * governs images, so every cross-origin R2 image on a public page was blocked
 * by this app's own policy, and a CSP-blocked image is an empty box rather than
 * an error. `og:image` kept working (a meta tag is never fetched by the page),
 * which is what made the pages look correct from the outside.
 *
 * So the assertions here are deliberately about the DIRECTIVE, not merely about
 * the origin appearing somewhere in the header: `img-src` must exist even when
 * nothing is configured, because the fall-through to `default-src` is the whole
 * bug, and an origin allowed only in `default-src` would still be blocked for
 * images by a present-but-narrow `img-src`.
 */
describe("buildSecurityHeaders — media img-src", () => {
  const MEDIA_BASE = "https://media.example.com/news";
  const MEDIA_ORIGIN = "https://media.example.com";

  test("names the configured media ORIGIN, so a cross-origin R2 image is not blocked by our own policy", () => {
    expect(directives(true, false, MEDIA_BASE)).toContain(
      `img-src 'self' data: ${MEDIA_ORIGIN}`
    );
  });

  test("uses the origin, never the configured path — a path prefix is a different (and redirect-fragile) policy", () => {
    const policy = cspFor(true, false, MEDIA_BASE);

    expect(policy).toContain(`img-src 'self' data: ${MEDIA_ORIGIN}`);
    expect(policy).not.toContain(`${MEDIA_ORIGIN}/news`);
  });

  test("keeps a non-default port, which is part of the origin", () => {
    // Dropping it allows a host the deployment does not serve from and blocks
    // the one it does — the failure mode is identical to having no directive.
    expect(directives(true, false, "http://localhost:9000/media")).toContain(
      "img-src 'self' data: http://localhost:9000"
    );
  });

  test("emits img-src 'self' data: with NO origin when no media is configured — the LAN/offline guarantee", () => {
    const policy = cspFor(true, false, "");

    expect(directives(true, false, "")).toContain("img-src 'self' data:");
    // Same assertion the LAN/offline case above makes about the whole policy,
    // restated here so this describe fails on its own if a future edit hardcodes
    // an origin into the directive.
    expect(policy).not.toMatch(/https?:\/\//);
  });

  test("a set-but-malformed media value adds no origin at all, rather than a broken one", () => {
    // `deriveMediaPublicOrigin` already decides this; the point here is that the
    // decision is honoured. A malformed host-source can make a browser reject
    // the ENTIRE policy, taking `frame-ancestors`/`object-src` down with it.
    for (const value of [
      "media.example.com",
      "not a url",
      "file:///srv/media"
    ]) {
      expect(directives(true, false, value)).toContain("img-src 'self' data:");
    }
  });

  test("is additive: enabling media changes img-src and media-src and nothing else", () => {
    const withoutMedia = directives(true, false, "");
    const withMedia = directives(true, false, MEDIA_BASE);

    expect(withMedia.filter((d) => !withoutMedia.includes(d))).toEqual([
      `img-src 'self' data: ${MEDIA_ORIGIN}`,
      `media-src 'self' ${MEDIA_ORIGIN}`
    ]);
    expect(
      withoutMedia
        .filter((d) => !d.startsWith("img-src") && !d.startsWith("media-src"))
        .every((d) => withMedia.includes(d))
    ).toBe(true);
  });

  // The gallery renderer emits `<img>` and `<video>` from the SAME R2 URL, so a
  // policy that admits one and not the other is the original defect surviving
  // half-fixed: images load, videos beside them stay blocked, and nothing errors.
  test("admits gallery video from the same origin it admits gallery images from", () => {
    const list = directives(true, false, MEDIA_BASE);

    expect(list).toContain(`media-src 'self' ${MEDIA_ORIGIN}`);
  });

  test("media-src carries no data: — nothing emits a data-URI video", () => {
    expect(
      directives(true, false, MEDIA_BASE).find((d) => d.startsWith("media-src"))
    ).not.toContain("data:");
  });

  test("composes with Turnstile — both origins present, each only in its own directive", () => {
    const list = directives(true, true, MEDIA_BASE);

    expect(list).toContain(`img-src 'self' data: ${MEDIA_ORIGIN}`);
    expect(list).toContain(
      `script-src 'self' '${THEME_INIT_SCRIPT_HASH}' https://challenges.cloudflare.com`
    );
    expect(list).toContain("frame-src https://challenges.cloudflare.com");
    // The media origin must NOT leak into script-src/frame-src: it serves
    // operator-uploaded bytes, which is exactly what must never be executable.
    expect(list.find((d) => d.startsWith("script-src"))).not.toContain(
      MEDIA_ORIGIN
    );
    expect(list.find((d) => d.startsWith("frame-src"))).not.toContain(
      MEDIA_ORIGIN
    );
  });

  test("falls back to the deployment's own NEWS_MEDIA_R2_PUBLIC_BASE_URL when no caller passes one — an inert fix is the failure mode here", () => {
    // `src/middleware.ts` and `src/lib/server/standalone-entry.ts` call
    // `buildSecurityHeaders` WITHOUT this option, so if the default were the
    // unconfigured value the directive would be right in every test and wrong on
    // every real deployment.
    const previous = process.env.NEWS_MEDIA_R2_PUBLIC_BASE_URL;
    process.env.NEWS_MEDIA_R2_PUBLIC_BASE_URL = MEDIA_BASE;

    try {
      const policy = buildSecurityHeaders({ isProduction: true }).find(
        ([name]) => name === "Content-Security-Policy"
      )?.[1];

      expect(policy).toContain(`img-src 'self' data: ${MEDIA_ORIGIN}`);
    } finally {
      if (previous === undefined) {
        delete process.env.NEWS_MEDIA_R2_PUBLIC_BASE_URL;
      } else {
        process.env.NEWS_MEDIA_R2_PUBLIC_BASE_URL = previous;
      }
    }
  });

  test("an explicit empty string means unconfigured, not 'read the environment'", () => {
    const previous = process.env.NEWS_MEDIA_R2_PUBLIC_BASE_URL;
    process.env.NEWS_MEDIA_R2_PUBLIC_BASE_URL = MEDIA_BASE;

    try {
      // Every other case in this file relies on this: without it the suite's
      // exact-policy assertions would depend on the developer's `.env`.
      expect(cspFor(true, false, "")).not.toContain(MEDIA_ORIGIN);
    } finally {
      if (previous === undefined) {
        delete process.env.NEWS_MEDIA_R2_PUBLIC_BASE_URL;
      } else {
        process.env.NEWS_MEDIA_R2_PUBLIC_BASE_URL = previous;
      }
    }
  });
});

/**
 * Issue #595 — `connect-src` and the direct-to-R2 upload.
 *
 * This is the third directive this policy needed and did not name; the first
 * two (`img-src`, `media-src`) each made something render as nothing, and this
 * one made a whole feature impossible: with `connect-src` falling through to
 * `default-src 'self'`, the browser refuses the presigned `PUT` before a byte
 * leaves the machine.
 *
 * The sharpest case here is `does NOT reuse the public media origin` — a policy
 * built from the wrong R2 origin reads correctly and still blocks every upload.
 */
describe("buildSecurityHeaders — media upload connect-src (Issue #595)", () => {
  const ACCOUNT = "abc123def456";
  const UPLOAD_ORIGIN = `https://${ACCOUNT}.r2.cloudflarestorage.com`;
  // Deliberately re-declared rather than shared with the img-src suite: the
  // point of these cases is that the READ origin and the WRITE origin are
  // different values, so they are written out separately here.
  const READ_BASE = "https://media.example.com/news";
  const READ_ORIGIN = "https://media.example.com";

  test("names the R2 API origin, so the presigned PUT is not blocked by our own policy", () => {
    expect(directives(false, false, "", ACCOUNT)).toContain(
      `connect-src 'self' ${UPLOAD_ORIGIN}`
    );
  });

  test("emits connect-src 'self' with NO origin when uploads are not configured — the LAN/offline guarantee", () => {
    expect(directives()).toContain("connect-src 'self'");
    expect(cspFor(true)).not.toContain("r2.cloudflarestorage.com");
  });

  test("does NOT reuse the public media origin — reads and writes go to different hosts", () => {
    // The trap this test exists for: using `mediaPublicBaseUrl` for connect-src
    // yields a policy that looks configured and still blocks every upload,
    // because the presigned PUT never goes to the custom read domain.
    const policy = cspFor(false, false, READ_BASE, ACCOUNT);
    const connect = policy
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("connect-src"));

    expect(connect).toBe(`connect-src 'self' ${UPLOAD_ORIGIN}`);
    expect(connect).not.toContain(READ_ORIGIN);
  });

  test("a malformed account id adds no origin at all, rather than a broken one", () => {
    // A rejected policy takes every other directive down with it, so a value
    // that cannot be a host must degrade to "no source", never to a guess.
    expect(directives(false, false, "", "not a valid host!")).toContain(
      "connect-src 'self'"
    );
  });

  test("is additive: enabling uploads changes connect-src and nothing else", () => {
    const off = directives(false, false, "", "");
    const on = directives(false, false, "", ACCOUNT);

    expect(on.length).toBe(off.length);
    expect(on.filter((d) => !d.startsWith("connect-src"))).toEqual(
      off.filter((d) => !d.startsWith("connect-src"))
    );
  });

  test("an explicit empty string means unconfigured, not 'read the environment'", () => {
    const previous = process.env.NEWS_MEDIA_R2_ACCOUNT_ID;
    process.env.NEWS_MEDIA_R2_ACCOUNT_ID = ACCOUNT;

    try {
      expect(cspFor(true, false, "", "")).not.toContain(UPLOAD_ORIGIN);
    } finally {
      if (previous === undefined) {
        delete process.env.NEWS_MEDIA_R2_ACCOUNT_ID;
      } else {
        process.env.NEWS_MEDIA_R2_ACCOUNT_ID = previous;
      }
    }
  });

  test("falls back to the deployment's own NEWS_MEDIA_R2_ACCOUNT_ID when no caller passes one — an inert fix is the failure mode here", () => {
    // Both real call sites (`src/middleware.ts`, `standalone-entry.ts`) omit
    // the option, so if the default did not read the environment the directive
    // would be permanently `'self'` and every upload would stay blocked while
    // this suite passed.
    const previous = process.env.NEWS_MEDIA_R2_ACCOUNT_ID;
    process.env.NEWS_MEDIA_R2_ACCOUNT_ID = ACCOUNT;

    try {
      const header = buildSecurityHeaders({ isProduction: false }).find(
        ([name]) => name === "Content-Security-Policy"
      );

      expect(header?.[1]).toContain(`connect-src 'self' ${UPLOAD_ORIGIN}`);
    } finally {
      if (previous === undefined) {
        delete process.env.NEWS_MEDIA_R2_ACCOUNT_ID;
      } else {
        process.env.NEWS_MEDIA_R2_ACCOUNT_ID = previous;
      }
    }
  });
});

describe("video embeds — the second and last opt-in origin (ADR-0110)", () => {
  test("the flag is OFF unless the value is literally `true`", () => {
    // `Boolean(env.X)` would make the string "false" enable it, and this switch
    // decides whether a third-party origin enters the policy.
    expect(isVideoEmbedEnabled({})).toBe(false);
    expect(isVideoEmbedEnabled({ BLOG_VIDEO_EMBED_ENABLED: "false" })).toBe(
      false
    );
    expect(isVideoEmbedEnabled({ BLOG_VIDEO_EMBED_ENABLED: "1" })).toBe(false);
    expect(isVideoEmbedEnabled({ BLOG_VIDEO_EMBED_ENABLED: "TRUE" })).toBe(
      false
    );
    expect(isVideoEmbedEnabled({ BLOG_VIDEO_EMBED_ENABLED: "true" })).toBe(
      true
    );
  });

  test("disabled (the default) adds nothing at all — the policy is byte-for-byte the pre-ADR-0110 one", () => {
    expect(cspFor(true, false, "", "", false)).toBe(cspFor(true, false));
    expect(cspFor(true, false, "", "", false)).not.toContain(
      "youtube-nocookie"
    );
    expect(cspFor(true, false, "", "", false)).not.toContain("frame-src");
  });

  test("enabled adds `frame-src` with exactly ONE origin, and changes nothing else", () => {
    const disabled = directives(true, false, "", "", false);
    const enabled = directives(true, false, "", "", true);

    expect(enabled.filter((d) => !disabled.includes(d))).toEqual([
      `frame-src ${VIDEO_EMBED_ORIGIN}`
    ]);
    // Nothing is REMOVED either — the delta is additive in both directions.
    expect(disabled.every((d) => enabled.includes(d))).toBe(true);
    // Not `script-src`: the embed is an iframe, and the widget-script opening
    // Turnstile needs is not something a video block ever asks for.
    expect(enabled.find((d) => d.startsWith("script-src"))).toBe(
      disabled.find((d) => d.startsWith("script-src"))
    );
  });

  test("with BOTH switches on, `frame-src` lists both origins in a fixed order", () => {
    const both = directives(true, true, "", "", true);
    const frameSrc = both.find((d) => d.startsWith("frame-src"));

    // A deterministic string: a header whose text depends on iteration order
    // makes a cached response and a fresh one differ for no reason.
    expect(frameSrc).toBe(
      `frame-src https://challenges.cloudflare.com ${VIDEO_EMBED_ORIGIN}`
    );
  });

  test("the video origin never leaks into the Turnstile-only policy", () => {
    // The guarantee this whole family of tests exists for, restated for the
    // second origin: enabling one switch must not open the other's origin.
    expect(cspFor(true, true, "", "", false)).not.toContain("youtube-nocookie");
    expect(cspFor(true, false, "", "", true)).not.toContain(
      "challenges.cloudflare.com"
    );
  });

  test("frame-ancestors stays 'none' and X-Frame-Options stays DENY", () => {
    // Opening `frame-src` says what THIS page may embed. It says nothing about
    // who may embed this page, and the two are easy to conflate.
    const headers = buildSecurityHeaders({
      isProduction: true,
      videoEmbedEnabled: true
    });

    expect(headers).toContainEqual(["X-Frame-Options", "DENY"]);
    expect(cspFor(true, false, "", "", true)).toContain(
      "frame-ancestors 'none'"
    );
  });
});
