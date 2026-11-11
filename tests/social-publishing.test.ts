/**
 * Pure unit tests for `social_publishing` (Issue #1145, ADR-0157): the content
 * snapshot and its eligibility rules, the provider-support check, idempotency,
 * retry and hold decisions, the derived aggregate status, request validation,
 * the adapter registry and the publisher-shape pre-filter. No database.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { buildAdapterHttp } from "../src/modules/social-publishing/application/social-publish-dispatch";
import {
  acceptExternalPostId,
  acceptExternalPostUrl,
  isAnchoredPattern
} from "../src/modules/social-publishing/domain/social-publish-post-reference";
import {
  SOCIAL_PUBLISHING_DEFAULT_RETENTION_DAYS,
  clampSocialPublishingRetentionDays
} from "../src/modules/social-publishing/domain/social-publishing-lifecycle";
import { isPublisherShape } from "../src/modules/channel-accounts/application/channel-account-port-adapter";
import {
  buildContentSnapshot,
  buildSocialPublishIdempotencyKey,
  checkAdapterSupport,
  composeArticleCaption,
  evaluateMediaEligibility,
  isSafeLinkUrl,
  type MediaFacts
} from "../src/modules/social-publishing/domain/social-publish-content";
import {
  classifyAccountReason,
  decideRetry,
  deriveAggregateStatus,
  holdsExhausted
} from "../src/modules/social-publishing/domain/social-publish-retry";
import {
  MAX_HOLDS,
  isSocialPublishingEnabled
} from "../src/modules/social-publishing/domain/social-publishing-constants";
import {
  validateCancel,
  validateCreatePublication,
  validateCreateRule,
  validateListPublicationsQuery,
  validateRetry,
  validateRulePatch,
  validateSchedule,
  validateSettingsPatch
} from "../src/modules/social-publishing/domain/social-publishing-validation";
import {
  createSocialAdapterRegistry,
  registerSocialPublishAdapter,
  resetSocialPublishAdaptersForTests,
  socialAdapterRegistry
} from "../src/modules/social-publishing/infrastructure/social-adapter-registry";
import {
  FULL_CAPABILITIES,
  TEXT_ONLY_CAPABILITIES,
  createFakeSocialAdapter
} from "./support/fake-social-publish-adapter";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

const IMAGE: MediaFacts = {
  publicUrl: "https://cdn.example/m/1.jpg",
  altText: null,
  mimeType: "image/jpeg",
  sizeBytes: 2_000_000,
  creditLine: "Studio",
  copyrightStatus: "owned"
};

afterEach(() => resetSocialPublishAdaptersForTests());

describe("the deployment switch", () => {
  test("is on only for the exact string true", () => {
    expect(isSocialPublishingEnabled({} as NodeJS.ProcessEnv)).toBe(false);

    for (const value of ["", "TRUE", "1", "yes", " true", "false"]) {
      expect(
        isSocialPublishingEnabled({
          SOCIAL_PUBLISHING_ENABLED: value
        } as unknown as NodeJS.ProcessEnv)
      ).toBe(false);
    }

    expect(
      isSocialPublishingEnabled({
        SOCIAL_PUBLISHING_ENABLED: "true"
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(true);
  });
});

describe("links", () => {
  test("only a plain https URL on a named host is accepted", () => {
    for (const ok of [
      "https://news.example/blog/a/b",
      "https://a.b.example/x?y=1#z"
    ]) {
      expect(isSafeLinkUrl(ok), ok).toBe(true);
    }

    for (const bad of [
      "http://news.example/a",
      "https://user:pw@news.example/",
      "https://news.example/a b",
      "https://localhost/a",
      "https://127.0.0.1/a",
      "https://[::1]/a",
      "javascript:alert(1)",
      "//news.example/a",
      "https://" + "a".repeat(2100) + ".example/",
      ""
    ]) {
      expect(isSafeLinkUrl(bad), bad).toBe(false);
    }
  });
});

describe("the article caption", () => {
  test("prefers the excerpt, falls back to the title, and truncates only into the storage ceiling", () => {
    expect(composeArticleCaption("Title", "  An   excerpt. ")).toBe(
      "An excerpt."
    );
    expect(composeArticleCaption("  Only   title ", null)).toBe("Only title");
    expect(composeArticleCaption("T", "   ")).toBe("T");

    const long = composeArticleCaption("T", "word ".repeat(1000));

    expect(long.length).toBeLessThanOrEqual(2000);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("media eligibility (fail closed on every missing fact)", () => {
  test("accepts a verified, rights-known, allowed image within the ceiling", () => {
    expect(evaluateMediaEligibility(IMAGE)).toMatchObject({ ok: true });
  });

  test.each([
    ["a GIF", { mimeType: "image/gif" }],
    ["an SVG", { mimeType: "image/svg+xml" }],
    ["a video", { mimeType: "video/mp4" }],
    ["an unknown size", { sizeBytes: null }],
    ["a zero size", { sizeBytes: 0 }],
    ["an oversize file", { sizeBytes: 11 * 1024 * 1024 }],
    ["a non-https URL", { publicUrl: "http://cdn.example/m.jpg" }],
    ["an unverified rights status", { copyrightStatus: null }],
    ["an unknown rights status", { copyrightStatus: "unknown" }]
  ])("refuses %s", (_label, over) => {
    expect(evaluateMediaEligibility({ ...IMAGE, ...over })).toEqual({
      ok: false
    });
  });
});

describe("the content snapshot", () => {
  const base = {
    title: "Headline",
    caption: "Caption.",
    linkUrl: "https://news.example/a",
    media: null
  };

  test("builds a text variant, then an image variant, with a stable hash", () => {
    const text = buildContentSnapshot(base);
    const image = buildContentSnapshot({ ...base, media: IMAGE });
    const again = buildContentSnapshot(base);

    expect(text).toMatchObject({ ok: true, snapshot: { variant: "text" } });
    expect(image).toMatchObject({ ok: true, snapshot: { variant: "image" } });

    if (!text.ok || !image.ok || !again.ok) throw new Error("fixture");

    expect(text.snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(again.snapshot.contentHash).toBe(text.snapshot.contentHash);
    expect(image.snapshot.contentHash).not.toBe(text.snapshot.contentHash);
  });

  test("refuses with a CODE, never the value", () => {
    expect(buildContentSnapshot({ ...base, title: "  " })).toEqual({
      ok: false,
      code: "TITLE_INVALID"
    });
    expect(buildContentSnapshot({ ...base, caption: "" })).toEqual({
      ok: false,
      code: "CAPTION_INVALID"
    });
    expect(buildContentSnapshot({ ...base, caption: "a\u0000b" })).toEqual({
      ok: false,
      code: "CAPTION_INVALID"
    });
    expect(
      buildContentSnapshot({ ...base, linkUrl: "http://news.example/a" })
    ).toEqual({ ok: false, code: "LINK_INVALID" });
    expect(
      buildContentSnapshot({
        ...base,
        media: { ...IMAGE, mimeType: "image/gif" }
      })
    ).toEqual({ ok: false, code: "MEDIA_NOT_ELIGIBLE" });
  });
});

describe("the provider capability map is a ceiling, never a downgrade", () => {
  const text = {
    variant: "text" as const,
    caption: "Hello",
    linkUrl: null,
    media: null
  };
  const image = {
    variant: "image" as const,
    caption: "Hello",
    linkUrl: "https://news.example/a",
    media: {
      publicUrl: "https://cdn.example/m.png",
      mimeType: "image/png",
      sizeBytes: 3_000_000,
      altText: null,
      creditLine: null,
      copyrightStatus: "owned"
    }
  };

  test("a text-only provider refuses an image rather than posting it as text", () => {
    expect(checkAdapterSupport(TEXT_ONLY_CAPABILITIES, image)).toEqual({
      ok: false,
      code: "VARIANT_UNSUPPORTED"
    });
    expect(checkAdapterSupport(TEXT_ONLY_CAPABILITIES, text)).toEqual({
      ok: true
    });
  });

  test("a type, a size and a length the provider cannot carry are each a refusal", () => {
    expect(
      checkAdapterSupport(
        { ...FULL_CAPABILITIES, imageMimeTypes: ["image/jpeg"] },
        image
      )
    ).toEqual({ ok: false, code: "MEDIA_TYPE_UNSUPPORTED" });
    expect(
      checkAdapterSupport({ ...FULL_CAPABILITIES, maxImageBytes: 1000 }, image)
    ).toEqual({ ok: false, code: "MEDIA_TOO_LARGE" });
    expect(
      checkAdapterSupport(
        { ...FULL_CAPABILITIES, maxCaptionLength: 10 },
        { ...text, caption: "x".repeat(11) }
      )
    ).toEqual({ ok: false, code: "CONTENT_TOO_LONG" });
    // The link counts, with one separator.
    expect(
      checkAdapterSupport(
        { ...FULL_CAPABILITIES, maxCaptionLength: 20 },
        { ...text, caption: "x".repeat(10), linkUrl: "https://a.example/" }
      )
    ).toEqual({ ok: false, code: "CONTENT_TOO_LONG" });
    expect(checkAdapterSupport(FULL_CAPABILITIES, image)).toEqual({ ok: true });
  });
});

describe("idempotency key", () => {
  test("is deterministic per (tenant, source, trigger, account) and distinct otherwise", () => {
    const a = buildSocialPublishIdempotencyKey(ID, ID2, "post_published", ID);

    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(
      buildSocialPublishIdempotencyKey(ID, ID2, "post_published", ID)
    ).toBe(a);

    for (const other of [
      buildSocialPublishIdempotencyKey(ID2, ID2, "post_published", ID),
      buildSocialPublishIdempotencyKey(ID, ID, "post_published", ID),
      buildSocialPublishIdempotencyKey(ID, ID2, "scheduled_published", ID),
      buildSocialPublishIdempotencyKey(ID, ID2, "post_published", ID2)
    ]) {
      expect(other).not.toBe(a);
    }
  });
});

describe("retry, hold and the aggregate status", () => {
  test("backoff grows, is capped, a provider hint only lengthens it, and the budget ends", () => {
    const one = decideRetry(1, 5, NOW);
    const two = decideRetry(2, 5, NOW);

    expect(one).toMatchObject({ retry: true });
    expect(two).toMatchObject({ retry: true });

    if (!one.retry || !two.retry) throw new Error("fixture");

    expect(two.nextAttemptAt.getTime()).toBeGreaterThan(
      one.nextAttemptAt.getTime()
    );
    expect(decideRetry(5, 5, NOW)).toEqual({ retry: false });

    const capped = decideRetry(40, 50, NOW);

    if (!capped.retry) throw new Error("fixture");

    expect(capped.nextAttemptAt.getTime() - NOW.getTime()).toBe(240 * 60_000);

    const tiny = decideRetry(1, 5, NOW, 1);
    const long = decideRetry(1, 5, NOW, 3600);

    if (!tiny.retry || !long.retry) throw new Error("fixture");

    // An implausibly short hint cannot shorten the exponential floor.
    expect(tiny.nextAttemptAt.getTime()).toBe(one.nextAttemptAt.getTime());
    expect(long.nextAttemptAt.getTime() - NOW.getTime()).toBe(3600 * 1000);
  });

  test("a recoverable account problem holds; everything else fails; holds are bounded", () => {
    for (const reason of [
      "ACCOUNT_DEGRADED",
      "ACCOUNT_PENDING",
      "CONNECTION_EXPIRED",
      "SECRET_STORE_UNAVAILABLE"
    ] as const) {
      expect(classifyAccountReason(reason)).toEqual({ kind: "hold" });
    }

    for (const reason of [
      "ACCOUNT_REVOKED",
      "ACCOUNT_DISABLED",
      "ACCOUNT_NOT_FOUND",
      "CONNECTION_NOT_ACTIVE",
      "CAPABILITY_DENIED",
      "CREDENTIAL_UNAVAILABLE",
      "NOT_A_PUBLISHER",
      "CHANNEL_ACCOUNTS_DISABLED"
    ] as const) {
      expect(classifyAccountReason(reason)).toMatchObject({ kind: "fail" });
    }

    expect(holdsExhausted(MAX_HOLDS - 1)).toBe(false);
    expect(holdsExhausted(MAX_HOLDS)).toBe(true);
  });

  test("the aggregate status is derived from the state and the jobs", () => {
    const status = deriveAggregateStatus;

    expect(status("refused", [])).toBe("refused");
    expect(status("pending_approval", ["queued"])).toBe("pending_approval");
    expect(status("ready", ["queued", "queued"])).toBe("queued");
    expect(status("ready", ["publishing", "queued"])).toBe("in_progress");
    expect(status("ready", ["retry_wait"])).toBe("in_progress");
    expect(status("ready", ["published", "queued"])).toBe(
      "partially_published"
    );
    expect(status("ready", ["published", "failed"])).toBe(
      "partially_published"
    );
    expect(status("ready", ["published", "published"])).toBe("published");
    expect(status("ready", ["failed", "failed"])).toBe("failed");
    expect(status("cancelled", ["cancelled", "cancelled"])).toBe("cancelled");
    expect(status("cancelled", ["published", "cancelled"])).toBe(
      "partially_published"
    );
    expect(status("ready", ["failed", "queued"])).toBe("queued");
    // An unknown outcome outranks everything but a refused or waiting publication.
    expect(status("ready", ["published", "needs_reconciliation"])).toBe(
      "needs_reconciliation"
    );
    expect(status("ready", ["needs_reconciliation", "failed"])).toBe(
      "needs_reconciliation"
    );
    expect(status("pending_approval", ["needs_reconciliation"])).toBe(
      "pending_approval"
    );
  });
});

describe("request validation is strict", () => {
  const good = {
    title: "T",
    caption: "C",
    accountIds: [ID]
  };

  test("a credential-shaped or provider-shaped field is refused as unknown", () => {
    for (const field of [
      "token",
      "accessToken",
      "secret",
      "provider",
      "pageId",
      "phoneNumberId",
      "tenantId"
    ]) {
      const result = validateCreatePublication({ ...good, [field]: "x" }, NOW);

      expect(result.valid, field).toBe(false);

      if (!result.valid) {
        expect(result.errors).toContainEqual({
          field,
          message: "Unknown field."
        });
      }
    }
  });

  test("accounts are required, deduplicated, UUIDs and bounded", () => {
    const run = (accountIds: unknown) =>
      validateCreatePublication({ ...good, accountIds }, NOW);

    expect(run([])).toMatchObject({ valid: false });
    expect(run("x")).toMatchObject({ valid: false });
    expect(run(["nope"])).toMatchObject({ valid: false });
    expect(
      run(
        Array.from(
          { length: 21 },
          (_, i) => `${ID.slice(0, -2)}${String(i).padStart(2, "0")}`
        )
      )
    ).toMatchObject({ valid: false });

    const deduped = run([ID, ID.toUpperCase(), ID2]);

    expect(deduped).toMatchObject({ valid: true });

    if (deduped.valid) expect(deduped.value.accountIds).toEqual([ID, ID2]);
  });

  test("a schedule must be an offset timestamp in the future, within a year", () => {
    const run = (notBefore: unknown) =>
      validateCreatePublication({ ...good, notBefore }, NOW);

    expect(run("2026-11-03T11:00:00Z")).toMatchObject({ valid: true });
    expect(run("2026-11-03T20:00:00+07:00")).toMatchObject({ valid: true });
    expect(run(null)).toMatchObject({ valid: true });
    expect(run("2026-11-03T09:00:00Z")).toMatchObject({ valid: false });
    expect(run("2026-11-03 11:00:00")).toMatchObject({ valid: false });
    expect(run("2026-11-03T11:00:00")).toMatchObject({ valid: false });
    expect(run("2028-01-01T00:00:00Z")).toMatchObject({ valid: false });
    expect(run(12345)).toMatchObject({ valid: false });
    expect(validateSchedule({ notBefore: null }, NOW)).toMatchObject({
      valid: true
    });
    expect(validateSchedule({}, NOW)).toMatchObject({ valid: false });
  });

  test("control characters and oversize text are refused", () => {
    expect(
      validateCreatePublication({ ...good, caption: "a\u0001b" }, NOW)
    ).toMatchObject({ valid: false });
    expect(
      validateCreatePublication({ ...good, title: "x".repeat(301) }, NOW)
    ).toMatchObject({ valid: false });
    expect(
      validateCreatePublication({ ...good, caption: "x".repeat(2001) }, NOW)
    ).toMatchObject({ valid: false });
    expect(validateCreatePublication([], NOW)).toMatchObject({ valid: false });
  });

  test("cancel, rule, settings and list inputs", () => {
    expect(validateCancel(null)).toEqual({
      valid: true,
      value: { reason: null }
    });
    expect(validateCancel({ reason: "why" })).toMatchObject({ valid: true });
    expect(validateCancel({ reason: "x".repeat(301) })).toMatchObject({
      valid: false
    });
    expect(validateCancel({ extra: 1 })).toMatchObject({ valid: false });

    expect(
      validateCreateRule({ trigger: "post_published", accountId: ID })
    ).toMatchObject({ valid: true });
    expect(
      validateCreateRule({ trigger: "nope", accountId: ID })
    ).toMatchObject({ valid: false });
    expect(validateRulePatch({ enabled: false })).toMatchObject({
      valid: true
    });
    expect(validateRulePatch({ enabled: "no" })).toMatchObject({
      valid: false
    });

    expect(validateSettingsPatch({ approvalRequired: false })).toMatchObject({
      valid: true
    });
    expect(validateSettingsPatch({})).toMatchObject({ valid: false });
    expect(validateSettingsPatch({ other: true })).toMatchObject({
      valid: false
    });

    expect(
      validateListPublicationsQuery(new URLSearchParams("limit=500"))
    ).toMatchObject({ valid: false });
    expect(
      validateListPublicationsQuery(new URLSearchParams("state=ready&limit=10"))
    ).toMatchObject({ valid: true });
    expect(
      validateListPublicationsQuery(new URLSearchParams("state=bogus"))
    ).toMatchObject({ valid: false });
  });
});

describe("the retry body", () => {
  test("is optional, strict, and a confirmation is a boolean", () => {
    expect(validateRetry(undefined)).toEqual({
      valid: true,
      value: { confirmPossiblyPublished: false }
    });
    expect(validateRetry(null)).toMatchObject({ valid: true });
    expect(validateRetry({ confirmPossiblyPublished: true })).toEqual({
      valid: true,
      value: { confirmPossiblyPublished: true }
    });
    expect(validateRetry({ confirmPossiblyPublished: "yes" })).toMatchObject({
      valid: false
    });
    expect(validateRetry({ token: "x" })).toMatchObject({ valid: false });
    expect(validateRetry([])).toMatchObject({ valid: false });
  });
});

describe("the adapter HTTP client (M3 of the #1145 audit)", () => {
  test("never follows a redirect, so an Authorization header cannot reach another origin; and the call's signal cancels the request", async () => {
    const seenByTarget: (string | null)[] = [];
    const target = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        seenByTarget.push(request.headers.get("authorization"));

        return new Response("target");
      }
    });
    const redirector = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return new Response(null, {
          status: 302,
          headers: { location: `http://127.0.0.1:${target.port}/steal` }
        });
      }
    });
    const slowServer = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch() {
        await Bun.sleep(1500);

        return new Response("late");
      }
    });
    const env = {
      AUTH_SSO_ALLOW_INSECURE_HOSTS: [target, redirector, slowServer]
        .map((server) => `127.0.0.1:${server.port}`)
        .join(",")
    } as unknown as NodeJS.ProcessEnv;

    try {
      const http = buildAdapterHttp(env);
      const followed = await http(
        `http://127.0.0.1:${redirector.port}/publish`,
        {
          method: "POST",
          headers: { Authorization: "Bearer SECRET-TOKEN" },
          body: "{}"
        }
      );

      expect(followed).toEqual({ ok: false, reason: "too_many_redirects" });
      expect(seenByTarget).toEqual([]);

      const controller = new AbortController();
      const cancellable = buildAdapterHttp(env, controller.signal);
      const startedAt = Date.now();
      const pending = cancellable(`http://127.0.0.1:${slowServer.port}/slow`);

      setTimeout(() => controller.abort(), 100);

      const cancelled = await pending;

      expect(cancelled).toEqual({ ok: false, reason: "request_failed" });
      expect(Date.now() - startedAt).toBeLessThan(1000);
    } finally {
      target.stop(true);
      redirector.stop(true);
      slowServer.stop(true);
    }
  });
});

describe("the adapter registry", () => {
  test("is empty by default, which is the fail-closed state", () => {
    expect(socialAdapterRegistry.list()).toEqual([]);
    expect(socialAdapterRegistry.get("facebook")).toBeNull();
  });

  test("one adapter per provider, and an invalid key is refused", () => {
    registerSocialPublishAdapter(createFakeSocialAdapter("facebook"));

    expect(socialAdapterRegistry.get("facebook")?.provider).toBe("facebook");
    expect(() =>
      registerSocialPublishAdapter(createFakeSocialAdapter("facebook"))
    ).toThrow();
    expect(() =>
      registerSocialPublishAdapter(createFakeSocialAdapter("Not A Key"))
    ).toThrow();
  });

  test("a fixed registry serves only what it was given", () => {
    const fixed = createSocialAdapterRegistry([
      createFakeSocialAdapter("threads")
    ]);

    expect(fixed.get("threads")).not.toBeNull();
    expect(fixed.get("facebook")).toBeNull();
  });
});

describe("which accounts can ever publish (a pre-filter, not a grant)", () => {
  test.each([
    ["facebook", "page", true],
    ["instagram", "professional_account", true],
    ["threads", "profile", true],
    ["tiktok", "creator_account", true],
    ["youtube", "channel", true],
    ["linkedin", "organization_page", true],
    ["telegram", "channel", true],
    ["whatsapp_cloud", "waba_phone_number", false],
    ["whatsapp_cloud", "waba", false],
    ["starsender", "device", false],
    ["mailketing", "sender_identity", false],
    ["linkedin_member", "member", false],
    ["website", "form", false],
    ["facebook", "not_a_kind", false],
    ["no_such_provider", "page", false]
  ])("%s %s -> %s", (provider, kind, expected) => {
    expect(isPublisherShape(provider, kind)).toBe(expected);
  });
});

describe("the fake adapter", () => {
  test("is test-only: it lives under tests/ and records what it is handed", async () => {
    const fake = createFakeSocialAdapter("facebook");
    const outcome = await fake.publish({
      tenantId: "t",
      accountId: "a",
      provider: "facebook",
      accountKind: "page",
      externalId: "e",
      credential: "c",
      content: {
        variant: "text",
        title: "t",
        caption: "cap",
        linkUrl: null,
        media: null
      },
      idempotencyKey: "k",
      http: async () => ({ ok: false, reason: "request_failed" }),
      signal: new AbortController().signal
    });

    expect(outcome.outcome).toBe("published");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.credential).toBe("c");
  });
});

describe("L6 of the #1145 audit: the provider's post id and URL are checked, not stored as given", () => {
  const FB_ID = /^[0-9]{1,32}_[0-9]{1,32}$/;

  test("an id matching the adapter's anchored pattern and the sql/359 shape is accepted", () => {
    expect(acceptExternalPostId(FB_ID, "1234_5678")).toBe("1234_5678");
    expect(
      acceptExternalPostId(/^urn:li:share:[0-9]{1,32}$/, "urn:li:share:42")
    ).toBe("urn:li:share:42");
  });

  test("anything else is refused: wrong shape, whitespace, a body, an over-long or non-string value", () => {
    for (const raw of [
      "",
      "12 34",
      "1234_5678 Bearer abc",
      '{"error":"x"}',
      "https://evil.example/x",
      "a".repeat(129),
      null,
      42,
      undefined
    ]) {
      expect(acceptExternalPostId(/^[A-Za-z0-9._:-]{1,200}$/, raw)).toBeNull();
    }

    expect(acceptExternalPostId(FB_ID, "abc")).toBeNull();
  });

  test("an unanchored or multiline pattern matches nothing (it could match a substring of a longer value)", () => {
    expect(isAnchoredPattern(/[0-9]+/)).toBe(false);
    expect(isAnchoredPattern(/^[0-9]+/)).toBe(false);
    expect(isAnchoredPattern(/^[0-9]+$/m)).toBe(false);
    expect(acceptExternalPostId(/[0-9]+/, "123")).toBeNull();

    // A global flag must not make the check stateful.
    const g = /^[0-9]+$/g;

    expect(acceptExternalPostId(g, "123")).toBe("123");
    expect(acceptExternalPostId(g, "123")).toBe("123");
  });

  test("a post URL is kept only on a declared host, https, with no credentials", () => {
    const hosts = ["www.facebook.com"];

    expect(
      acceptExternalPostUrl(hosts, "https://www.facebook.com/1234_5678")
    ).toBe("https://www.facebook.com/1234_5678");

    for (const raw of [
      "https://evil.example/1234",
      "http://www.facebook.com/1234",
      "https://user:pass@www.facebook.com/1",
      "https://www.facebook.com.evil.example/1",
      "javascript:alert(1)",
      null
    ]) {
      expect(acceptExternalPostUrl(hosts, raw)).toBeNull();
    }

    expect(acceptExternalPostUrl([], "https://www.facebook.com/1")).toBeNull();
  });

  test("the registry refuses an adapter that cannot say what its ids look like", () => {
    expect(() =>
      createSocialAdapterRegistry([
        createFakeSocialAdapter("facebook", undefined, undefined, {
          externalPostIdPattern: /[0-9]+/
        })
      ])
    ).toThrow(/anchored/);
    expect(() =>
      createSocialAdapterRegistry([
        createFakeSocialAdapter("facebook", undefined, undefined, {
          postUrlHosts: ["https://www.facebook.com"]
        })
      ])
    ).toThrow(/hostnames/);
  });
});

describe("retention window (Issue #1145)", () => {
  test("defaults to 730 days and is clamped into 365..3650", () => {
    expect(SOCIAL_PUBLISHING_DEFAULT_RETENTION_DAYS).toBe(730);
    expect(clampSocialPublishingRetentionDays(30)).toBe(365);
    expect(clampSocialPublishingRetentionDays(100_000)).toBe(3650);
    expect(clampSocialPublishingRetentionDays(Number.NaN)).toBe(730);
    expect(clampSocialPublishingRetentionDays(900.7)).toBe(900);
  });
});
