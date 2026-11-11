/**
 * The Facebook Pages connector (Issue #1146), without a database: request
 * shape, error classification, media and page-id refusals, SSRF/redirect
 * behaviour through the real `ssrfSafeFetch` client, the flag-gated registry
 * and credential composition, and the dedicated-role job wiring.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import {
  DEDICATED_ROLE_CLIENT_FILES,
  dedicatedRoleTargets,
  renderRunnerDedicatedRoles,
  scopedPairs
} from "../scripts/jobs-env-allowlist";
import { composePublishCredentialPort } from "../scripts/social-publishing-dispatch";
import {
  socialDispatchLoginProblems,
  validateEnv
} from "../scripts/validate-env";
import type { SsrfGuardResult } from "../src/lib/auth/ssrf-guard";
import {
  SHARED_LOGIN_ENV_NAMES,
  assertNoSharedLogins
} from "../src/lib/database/social-publishing-dispatch-client";
import {
  buildAdapterHttp,
  noPublishCredentialPort
} from "../src/modules/social-publishing/application/social-publish-dispatch";
import type {
  SocialPublishContent,
  SocialPublishHttp,
  SocialPublishRequest
} from "../src/modules/social-publishing/domain/social-publish-adapter";
import { checkAdapterSupport } from "../src/modules/social-publishing/domain/social-publish-content";
import { acceptExternalPostId } from "../src/modules/social-publishing/domain/social-publish-post-reference";
import {
  FACEBOOK_CAPABILITIES,
  FACEBOOK_ERROR_CODES,
  FACEBOOK_GRAPH_API_VERSION,
  FACEBOOK_POST_ID,
  classifyGraphResponse,
  createFacebookPagesAdapter,
  facebookPagesAdapter,
  retryAfterFromUsageHeader
} from "../src/modules/social-publishing/infrastructure/facebook-pages-adapter";
import {
  builtInAdapter,
  createSocialAdapterRegistry
} from "../src/modules/social-publishing/infrastructure/social-adapter-registry";

const PAGE_ID = "102030405060";
const TOKEN = "EAAG-page-token-for-tests-only";

type Recorded = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

function fakeHttp(
  answer: () => SsrfGuardResult | Promise<SsrfGuardResult>
): SocialPublishHttp & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const http = (async (url, init) => {
    calls.push({
      url,
      method: init?.method,
      headers: init?.headers,
      body: typeof init?.body === "string" ? init.body : undefined
    });

    return answer();
  }) as SocialPublishHttp & { calls: Recorded[] };

  http.calls = calls;

  return http;
}

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): SsrfGuardResult => ({
  ok: true,
  response: new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  })
});

const TEXT: SocialPublishContent = {
  variant: "text",
  title: "Headline",
  caption: "A caption for the world.",
  linkUrl: "https://cms.example/blog/a/headline",
  media: null
};

const IMAGE: SocialPublishContent = {
  variant: "image",
  title: "Headline",
  caption: "Photo caption.",
  linkUrl: "https://cms.example/blog/a/headline",
  media: {
    publicUrl: "https://cdn.example/m/1.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1_000_000,
    altText: "A photo of the harbour",
    creditLine: "Studio"
  }
};

function request(
  http: SocialPublishHttp,
  over: Partial<SocialPublishRequest> = {}
): SocialPublishRequest {
  return {
    tenantId: "a1146000-0000-4000-8000-00000000000a",
    accountId: "a1146000-0000-4000-8000-0000000000a1",
    provider: "facebook",
    accountKind: "page",
    externalId: PAGE_ID,
    credential: TOKEN,
    content: TEXT,
    idempotencyKey: "a".repeat(64),
    http,
    signal: new AbortController().signal,
    ...over
  };
}

describe("the Graph API request", () => {
  test("a text post is POST /v27.0/{page-id}/feed with message and link, the token only in the Authorization header", async () => {
    const http = fakeHttp(() => json(200, { id: `${PAGE_ID}_998877` }));
    const outcome = await facebookPagesAdapter.publish(request(http));

    expect(outcome).toEqual({
      outcome: "published",
      externalPostId: `${PAGE_ID}_998877`,
      externalPostUrl: `https://www.facebook.com/${PAGE_ID}_998877`
    });
    expect(http.calls).toHaveLength(1);

    const call = http.calls[0]!;

    expect(call.url).toBe(
      `https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/${PAGE_ID}/feed`
    );
    expect(FACEBOOK_GRAPH_API_VERSION).toBe("v27.0");
    expect(call.method).toBe("POST");
    expect(call.headers?.Authorization).toBe(`Bearer ${TOKEN}`);

    const body = new URLSearchParams(call.body);

    expect(body.get("message")).toBe(TEXT.caption);
    expect(body.get("link")).toBe(TEXT.linkUrl);
    // The token is never in the URL or the body.
    expect(call.url).not.toContain(TOKEN);
    expect(call.body).not.toContain(TOKEN);
    expect(body.has("access_token")).toBe(false);
  });

  test("an image post is POST /{page-id}/photos with url, caption (the link appended) and alt text; the POST id is kept, not the photo id", async () => {
    const http = fakeHttp(() =>
      json(200, { id: "5550001", post_id: `${PAGE_ID}_4440001` })
    );
    const outcome = await facebookPagesAdapter.publish(
      request(http, { content: IMAGE })
    );

    expect(outcome).toMatchObject({
      outcome: "published",
      externalPostId: `${PAGE_ID}_4440001`
    });

    const call = http.calls[0]!;
    const body = new URLSearchParams(call.body);

    expect(call.url).toEndWith(`/${PAGE_ID}/photos`);
    expect(body.get("url")).toBe(IMAGE.media!.publicUrl);
    expect(body.get("caption")).toBe(`${IMAGE.caption}\n${IMAGE.linkUrl}`);
    expect(body.get("alt_text_custom")).toBe(IMAGE.media!.altText);
    expect(body.has("message")).toBe(false);
  });

  test("a page id that is not numeric is refused before any call (it would be a URL path segment)", async () => {
    for (const externalId of ["../me", "123/feed?x=", "abc", ""]) {
      const http = fakeHttp(() => json(200, { id: "1_1" }));
      const outcome = await facebookPagesAdapter.publish(
        request(http, { externalId })
      );

      expect(outcome).toEqual({
        outcome: "rejected",
        errorCode: "FB_PAGE_ID_INVALID"
      });
      expect(http.calls).toHaveLength(0);
    }
  });

  test("media is re-checked before Facebook is told to fetch it: http, WebP and >4 MB are refused without a call", async () => {
    for (const media of [
      { ...IMAGE.media!, publicUrl: "http://cdn.example/1.jpg" },
      { ...IMAGE.media!, publicUrl: "https://10.0.0.5/1.jpg" },
      { ...IMAGE.media!, mimeType: "image/webp" },
      { ...IMAGE.media!, sizeBytes: 4 * 1024 * 1024 + 1 },
      { ...IMAGE.media!, sizeBytes: 0 }
    ]) {
      const http = fakeHttp(() => json(200, { id: "1_1" }));
      const outcome = await facebookPagesAdapter.publish(
        request(http, { content: { ...IMAGE, media } })
      );

      expect(outcome).toEqual({
        outcome: "rejected",
        errorCode: "FB_MEDIA_INVALID"
      });
      expect(http.calls).toHaveLength(0);
    }
  });

  test("a variant the connector does not carry is refused, never downgraded", async () => {
    const http = fakeHttp(() => json(200, { id: "1_1" }));

    for (const content of [
      { ...TEXT, variant: "video" as const },
      { ...TEXT, variant: "image" as const },
      { ...IMAGE, variant: "text" as const }
    ]) {
      expect(
        await facebookPagesAdapter.publish(request(http, { content }))
      ).toEqual({ outcome: "rejected", errorCode: "FB_VARIANT_UNSUPPORTED" });
    }

    expect(http.calls).toHaveLength(0);
  });
});

describe("the capability map is a ceiling (enqueue)", () => {
  test("text and image only; JPEG and PNG up to 4 MB; WebP, larger images and video are refused", () => {
    expect(FACEBOOK_CAPABILITIES.variants).toEqual(["text", "image"]);

    const base = { caption: "c", linkUrl: null };

    expect(
      checkAdapterSupport(FACEBOOK_CAPABILITIES, {
        ...base,
        variant: "video",
        media: null
      })
    ).toEqual({ ok: false, code: "VARIANT_UNSUPPORTED" });
    expect(
      checkAdapterSupport(FACEBOOK_CAPABILITIES, {
        ...base,
        variant: "image",
        media: {
          publicUrl: "https://cdn.example/1.webp",
          mimeType: "image/webp",
          sizeBytes: 100,
          altText: null,
          creditLine: null,
          copyrightStatus: "owned"
        }
      })
    ).toEqual({ ok: false, code: "MEDIA_TYPE_UNSUPPORTED" });
    expect(
      checkAdapterSupport(FACEBOOK_CAPABILITIES, {
        ...base,
        variant: "image",
        media: {
          publicUrl: "https://cdn.example/1.png",
          mimeType: "image/png",
          sizeBytes: 5 * 1024 * 1024,
          altText: null,
          creditLine: null,
          copyrightStatus: "owned"
        }
      })
    ).toEqual({ ok: false, code: "MEDIA_TOO_LARGE" });
  });

  test("the post id pattern is anchored and is the {page}_{post} shape; the URL host is www.facebook.com only", () => {
    expect(FACEBOOK_POST_ID.source.startsWith("^")).toBe(true);
    expect(facebookPagesAdapter.supportsIdempotencyKey).toBe(false);
    expect(facebookPagesAdapter.postUrlHosts).toEqual(["www.facebook.com"]);
    expect(acceptExternalPostId(FACEBOOK_POST_ID, "123_456")).toBe("123_456");

    for (const bad of ["123", "123_456 ", "x123_456", "123_456_789", "a_b"]) {
      expect(acceptExternalPostId(FACEBOOK_POST_ID, bad)).toBeNull();
    }
  });
});

describe("error classification (Graph API error-handling and rate-limiting guides)", () => {
  const graph = (code: number, subcode?: number) => ({
    error: {
      message: `secret detail ${TOKEN}`,
      type: "OAuthException",
      code,
      ...(subcode === undefined ? {} : { error_subcode: subcode }),
      fbtrace_id: "trace"
    }
  });

  test.each([
    [400, graph(190), "needs_reauth", "FB_TOKEN_INVALID"],
    [400, graph(102), "needs_reauth", "FB_TOKEN_INVALID"],
    [400, graph(100, 463), "needs_reauth", "FB_TOKEN_INVALID"],
    [400, graph(100, 492), "needs_reauth", "FB_TOKEN_INVALID"],
    [403, graph(10), "needs_reauth", "FB_PERMISSION_DENIED"],
    [403, graph(200), "needs_reauth", "FB_PERMISSION_DENIED"],
    [403, graph(299), "needs_reauth", "FB_PERMISSION_DENIED"],
    [400, graph(4), "rate_limited", "FB_RATE_LIMITED"],
    [400, graph(17), "rate_limited", "FB_RATE_LIMITED"],
    [400, graph(32), "rate_limited", "FB_RATE_LIMITED"],
    [400, graph(341), "rate_limited", "FB_RATE_LIMITED"],
    [400, graph(613), "rate_limited", "FB_RATE_LIMITED"],
    [400, graph(80001), "rate_limited", "FB_RATE_LIMITED"],
    // L4 of the #1271 audit: code 2 is retried only on a 503 that says it is
    // transient; otherwise the post may exist.
    [503, graph(2), "unknown", "FB_TEMPORARY_OUTAGE"],
    [500, graph(2), "unknown", "FB_TEMPORARY_OUTAGE"],
    [
      503,
      { error: { code: 2, is_transient: true, message: "x" } },
      "retryable",
      "FB_TEMPORARY_OUTAGE"
    ],
    [
      500,
      { error: { code: 2, is_transient: true, message: "x" } },
      "unknown",
      "FB_TEMPORARY_OUTAGE"
    ],
    [400, graph(506), "unknown", "FB_DUPLICATE_POST"],
    [400, graph(368), "rejected", "FB_POLICY_BLOCK"],
    [400, graph(324), "rejected", "FB_MEDIA_REJECTED"],
    [400, graph(100), "rejected", "FB_INVALID_PARAMETER"],
    [500, graph(1), "unknown", "FB_UPSTREAM_UNKNOWN"],
    [500, graph(9999), "unknown", "FB_UPSTREAM_UNKNOWN"],
    [502, "<html>bad gateway</html>", "unknown", "FB_UPSTREAM_UNKNOWN"],
    [404, null, "rejected", "FB_REQUEST_REJECTED"],
    [400, graph(9999), "rejected", "FB_REQUEST_REJECTED"],
    [200, { id: "not-a-post" }, "unknown", "FB_RESPONSE_UNREADABLE"],
    [200, null, "unknown", "FB_RESPONSE_UNREADABLE"]
  ] as const)("HTTP %i %j -> %s %s", (status, body, outcome, errorCode) => {
    const result = classifyGraphResponse(status, body, null);

    expect(result.outcome).toBe(outcome);
    expect((result as { errorCode: string }).errorCode).toBe(errorCode);
    // The closed vocabulary: the dispatcher records only declared codes.
    expect(FACEBOOK_ERROR_CODES as readonly string[]).toContain(errorCode);
    // No Graph message (here carrying the token) leaks into the outcome.
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test("the X-Business-Use-Case-Usage header sets the wait, bounded to a day", () => {
    const header = (minutes: number) =>
      JSON.stringify({
        [PAGE_ID]: [
          {
            type: "pages",
            call_count: 100,
            estimated_time_to_regain_access: 3
          },
          {
            type: "pages",
            call_count: 100,
            estimated_time_to_regain_access: minutes
          }
        ]
      });

    expect(retryAfterFromUsageHeader(header(19))).toBe(19 * 60);
    expect(retryAfterFromUsageHeader(header(100_000))).toBe(24 * 3600);
    expect(retryAfterFromUsageHeader(header(0))).toBe(3 * 60);
    expect(retryAfterFromUsageHeader("not json")).toBeUndefined();
    expect(retryAfterFromUsageHeader(null)).toBeUndefined();
    expect(
      classifyGraphResponse(400, { error: { code: 80001 } }, header(19))
    ).toEqual({
      outcome: "rate_limited",
      errorCode: "FB_RATE_LIMITED",
      retryAfterSeconds: 19 * 60
    });
  });

  test("a request that never left is retryable; one that may have been processed is unknown (never a blind retry)", async () => {
    for (const reason of [
      "invalid_url",
      "blocked_address",
      "dns_resolution_failed",
      "scheme_not_allowed"
    ] as const) {
      expect(
        await facebookPagesAdapter.publish(
          request(fakeHttp(() => ({ ok: false, reason })))
        )
      ).toEqual({ outcome: "retryable", errorCode: "FB_NETWORK_NOT_SENT" });
    }

    for (const reason of [
      "request_failed",
      "response_too_large",
      "too_many_redirects"
    ] as const) {
      expect(
        await facebookPagesAdapter.publish(
          request(fakeHttp(() => ({ ok: false, reason })))
        )
      ).toEqual({ outcome: "unknown", errorCode: "FB_ANSWER_LOST" });
    }
  });
});

describe("SSRF and redirects through the real ssrfSafeFetch client", () => {
  test("a Graph origin on an internal address is blocked before anything is sent", async () => {
    const adapter = createFacebookPagesAdapter({
      graphOrigin: "https://127.0.0.1"
    });
    const outcome = await adapter.publish(
      request(buildAdapterHttp({} as NodeJS.ProcessEnv))
    );

    expect(outcome).toEqual({
      outcome: "retryable",
      errorCode: "FB_NETWORK_NOT_SENT"
    });
  });

  test("against a fake Graph server: published; a redirect is not followed and the token never reaches the target", async () => {
    const seenByTarget: (string | null)[] = [];
    const seenByGraph: { path: string; auth: string | null }[] = [];
    const target = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(incoming) {
        seenByTarget.push(incoming.headers.get("authorization"));

        return new Response("stolen");
      }
    });
    let redirect = false;
    const graph = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(incoming) {
        seenByGraph.push({
          path: new URL(incoming.url).pathname,
          auth: incoming.headers.get("authorization")
        });

        if (redirect) {
          return new Response(null, {
            status: 307,
            headers: { location: `http://127.0.0.1:${target.port}/steal` }
          });
        }

        return Response.json({ id: `${PAGE_ID}_42` });
      }
    });
    const env = {
      AUTH_SSO_ALLOW_INSECURE_HOSTS: [graph, target]
        .map((server) => `127.0.0.1:${server.port}`)
        .join(",")
    } as unknown as NodeJS.ProcessEnv;
    const adapter = createFacebookPagesAdapter({
      graphOrigin: `http://127.0.0.1:${graph.port}`
    });

    try {
      expect(
        await adapter.publish(request(buildAdapterHttp(env)))
      ).toMatchObject({
        outcome: "published",
        externalPostId: `${PAGE_ID}_42`
      });
      expect(seenByGraph[0]).toEqual({
        path: `/v27.0/${PAGE_ID}/feed`,
        auth: `Bearer ${TOKEN}`
      });

      redirect = true;

      expect(await adapter.publish(request(buildAdapterHttp(env)))).toEqual({
        outcome: "unknown",
        errorCode: "FB_ANSWER_LOST"
      });
      expect(seenByTarget).toEqual([]);
    } finally {
      graph.stop(true);
      target.stop(true);
    }
  });
});

describe("the switch: registry and credential composition (default OFF)", () => {
  const ON = {
    SOCIAL_PUBLISHING_ENABLED: "true",
    SOCIAL_PUBLISHING_FACEBOOK_ENABLED: "true"
  } as unknown as NodeJS.ProcessEnv;

  test("no Facebook adapter unless both switches are exactly true", () => {
    expect(builtInAdapter("facebook", {} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      builtInAdapter("facebook", {
        SOCIAL_PUBLISHING_FACEBOOK_ENABLED: "true"
      } as unknown as NodeJS.ProcessEnv)
    ).toBeNull();
    expect(
      builtInAdapter("facebook", {
        ...ON,
        SOCIAL_PUBLISHING_FACEBOOK_ENABLED: "1"
      } as unknown as NodeJS.ProcessEnv)
    ).toBeNull();
    expect(builtInAdapter("facebook", ON)).toBe(facebookPagesAdapter);
    expect(builtInAdapter("instagram", ON)).toBeNull();
  });

  test("the built-in adapter passes the registry's admission", () => {
    expect(() =>
      createSocialAdapterRegistry([facebookPagesAdapter])
    ).not.toThrow();
  });

  test("the dispatcher is composed with the refusing credential port unless the connector is on", () => {
    expect(composePublishCredentialPort({} as NodeJS.ProcessEnv)).toBe(
      noPublishCredentialPort
    );
    expect(
      composePublishCredentialPort({
        SOCIAL_PUBLISHING_FACEBOOK_ENABLED: "true"
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(noPublishCredentialPort);

    const real = composePublishCredentialPort(ON);

    expect(real).not.toBe(noPublishCredentialPort);
    // Only the publish method is exposed, never the WhatsApp one.
    expect(Object.keys(real)).toEqual(["resolvePublishCredential"]);
  });
});

describe("the dedicated-role job (ADR-0157 section 6)", () => {
  test("social-publishing:dispatch is the dedicated-role target and reaches no shared-role client", () => {
    const scripts = (
      JSON.parse(readFileSync("package.json", "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    const dedicated = dedicatedRoleTargets(scripts);

    expect(dedicated.problems).toEqual([]);
    expect(dedicated.targets).toContain("social-publishing:dispatch");
    expect(
      DEDICATED_ROLE_CLIENT_FILES[
        "src/lib/database/social-publishing-dispatch-client.ts"
      ]
    ).toBe("SOCIAL_PUBLISHING_DATABASE_URL");
    // The retention purge stays an awcms_worker job.
    expect(dedicated.targets).not.toContain(
      "social-publishing:retention:purge"
    );
  });

  test("the job holds the key ring and its own login, and the runner withholds every shared login from it", () => {
    const pairs = scopedPairs().filter(
      (pair) => pair.job === "social-publishing:dispatch"
    );

    expect(pairs.map((pair) => pair.name).sort()).toEqual([
      "CHANNEL_SECRETS_ENCRYPTION_KEYS",
      "SOCIAL_PUBLISHING_DATABASE_URL"
    ]);

    const runner = readFileSync("ops/run-job.sh", "utf8");

    // The generated block names every dedicated-role job (the Telegram
    // customer dispatcher too, Issue #1156), this one among them.
    expect(runner).toContain(
      renderRunnerDedicatedRoles([
        "social-publishing:dispatch",
        "telegram-engagement:dispatch"
      ])
    );
    expect(runner).toMatch(
      /ENVIRON\["DEDICATED"\] == "1" && \(\$1 == "DATABASE_URL" \|\| \$1 == "WORKER_DATABASE_URL" \|\| \$1 == "SETUP_DATABASE_URL"\)\) next/
    );
  });

  test("the job refuses to start with a shared login in its environment", () => {
    expect(SHARED_LOGIN_ENV_NAMES).toEqual([
      "DATABASE_URL",
      "WORKER_DATABASE_URL",
      "SETUP_DATABASE_URL"
    ]);

    for (const name of SHARED_LOGIN_ENV_NAMES) {
      expect(() =>
        assertNoSharedLogins({ [name]: "postgres://u:p@h/d" })
      ).toThrow(name);
    }

    expect(() => assertNoSharedLogins({ DATABASE_URL: "   " })).not.toThrow();
    expect(() => assertNoSharedLogins({})).not.toThrow();
  });

  test("config:validate requires its own login when the module is on, and refuses one shared with the app or worker", () => {
    expect(
      socialDispatchLoginProblems({ SOCIAL_PUBLISHING_ENABLED: "true" })
    ).toHaveLength(1);
    expect(
      socialDispatchLoginProblems({
        SOCIAL_PUBLISHING_DATABASE_URL:
          "postgres://awcms_social_dispatch:s@db:5432/awcms",
        DATABASE_URL: "postgres://awcms_app:s@db:5432/awcms",
        WORKER_DATABASE_URL: "postgres://awcms_worker:s@db:5432/awcms"
      })
    ).toEqual([]);
    expect(
      socialDispatchLoginProblems({
        SOCIAL_PUBLISHING_DATABASE_URL: "postgres://awcms_worker:s@db/awcms",
        WORKER_DATABASE_URL: "postgres://awcms_worker:t@db/awcms"
      })
    ).toHaveLength(1);

    // The #1271 audit, L2: the setup login counts as a shared login too.
    expect(
      socialDispatchLoginProblems({
        SOCIAL_PUBLISHING_DATABASE_URL: "postgres://awcms_setup:s@db/awcms",
        SETUP_DATABASE_URL: "postgres://awcms_setup:t@db/awcms"
      })
    ).toHaveLength(1);

    const problems = validateEnv({
      DATABASE_URL: "postgres://awcms_app:s@db:5432/awcms",
      APP_URL: "https://cms.example",
      SOCIAL_PUBLISHING_FACEBOOK_ENABLED: "true"
    });

    expect(
      problems.some((problem) =>
        problem.startsWith("SOCIAL_PUBLISHING_FACEBOOK_ENABLED=true")
      )
    ).toBe(true);
  });
});
