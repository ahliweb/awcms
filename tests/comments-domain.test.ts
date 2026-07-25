import { describe, expect, test } from "bun:test";

import {
  applyModerationAction,
  isLegalTransition,
  IllegalCommentTransitionError
} from "../src/modules/comments/domain/comment-status";
import { decideCommentPolicy } from "../src/modules/comments/domain/comment-policy";
import {
  buildBoundedThread,
  CommentDepthExceededError,
  HARD_MAX_DEPTH,
  resolveReplyDepth
} from "../src/modules/comments/domain/comment-thread";
import {
  countLinks,
  escapeCommentHtml,
  isSafeLinkUrl,
  normalizeCommentBody,
  renderCommentHtml
} from "../src/modules/comments/domain/comment-sanitization";
import {
  computeContentFingerprint,
  containsBlockedTerm,
  evaluateAntiAbuse
} from "../src/modules/comments/domain/anti-abuse";
import { validateCommentSettings } from "../src/modules/comments/domain/comment-settings";
import {
  mintTimingToken,
  verifyTimingToken
} from "../src/modules/comments/domain/timing-token";
import {
  collectCommentableResourceDescriptors,
  validateCommentableResourceRegistry
} from "../src/modules/comments/domain/commentable-resource-registry";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import { listModules } from "../src/modules/index";

describe("comment-status state machine", () => {
  test("legal transitions from pending", () => {
    expect(isLegalTransition("pending", "approved")).toBe(true);
    expect(isLegalTransition("pending", "rejected")).toBe(true);
    expect(isLegalTransition("pending", "spam")).toBe(true);
    expect(isLegalTransition("pending", "deleted")).toBe(true);
  });

  test("illegal: approve a deleted comment", () => {
    expect(isLegalTransition("deleted", "approved")).toBe(false);
    expect(() => applyModerationAction("deleted", "approve")).toThrow(
      IllegalCommentTransitionError
    );
  });

  test("approve marks visible; reject/spam do not", () => {
    expect(applyModerationAction("pending", "approve").publiclyVisible).toBe(
      true
    );
    expect(applyModerationAction("pending", "reject").publiclyVisible).toBe(
      false
    );
    expect(applyModerationAction("pending", "spam").status).toBe("spam");
  });

  test("archive only from approved, and stamps the reserved reason", () => {
    const out = applyModerationAction("approved", "archive");
    expect(out.status).toBe("rejected");
    expect(out.impliedReasonCode).toBe("archived");
    expect(() => applyModerationAction("pending", "archive")).toThrow();
  });

  test("restore returns rejected/spam to pending", () => {
    expect(applyModerationAction("rejected", "restore").status).toBe("pending");
    expect(applyModerationAction("spam", "restore").status).toBe("pending");
  });
});

describe("comment-policy decisions", () => {
  const settings = { requireModeration: true, allowAnonymous: true };

  test("disabled rejects everything", () => {
    const d = decideCommentPolicy({
      policyMode: "disabled",
      authorKind: "anonymous",
      threadClosed: false,
      settings
    });
    expect(d.accepted).toBe(false);
  });

  test("authenticated-only rejects anonymous", () => {
    const d = decideCommentPolicy({
      policyMode: "authenticated-only",
      authorKind: "anonymous",
      threadClosed: false,
      settings
    });
    expect(d).toEqual({ accepted: false, reason: "authentication_required" });
  });

  test("moderated-anonymous accepts anonymous but pending", () => {
    const d = decideCommentPolicy({
      policyMode: "moderated-anonymous",
      authorKind: "anonymous",
      threadClosed: false,
      settings
    });
    expect(d).toEqual({ accepted: true, initialStatus: "pending" });
  });

  test("closed thread rejects", () => {
    const d = decideCommentPolicy({
      policyMode: "moderated-anonymous",
      authorKind: "anonymous",
      threadClosed: true,
      settings
    });
    expect(d).toEqual({ accepted: false, reason: "thread_closed" });
  });

  test("registered auto-approves only when moderation disabled", () => {
    const d = decideCommentPolicy({
      policyMode: "authenticated-only",
      authorKind: "registered",
      threadClosed: false,
      settings: { requireModeration: false, allowAnonymous: false }
    });
    expect(d).toEqual({ accepted: true, initialStatus: "approved" });
  });
});

describe("comment-thread bounded depth", () => {
  test("top-level is depth 0", () => {
    expect(resolveReplyDepth(null, 3)).toBe(0);
  });

  test("reply depth is parent + 1, capped by tenant max", () => {
    expect(resolveReplyDepth(0, 3)).toBe(1);
    expect(() => resolveReplyDepth(3, 3)).toThrow(CommentDepthExceededError);
  });

  test("tenant max can only tighten, never exceed the hard cap", () => {
    expect(() => resolveReplyDepth(HARD_MAX_DEPTH, 99)).toThrow(
      CommentDepthExceededError
    );
  });

  test("buildBoundedThread nests replies and orphans attach as roots", () => {
    const now = Date.now();
    const tree = buildBoundedThread([
      { id: "a", parentId: null, depth: 0, createdAt: new Date(now) },
      { id: "b", parentId: "a", depth: 1, createdAt: new Date(now + 1) },
      { id: "c", parentId: "missing", depth: 1, createdAt: new Date(now + 2) }
    ]);
    expect(tree).toHaveLength(2); // a (with reply b) + orphan c as root
    const a = tree.find((n) => n.id === "a")!;
    expect(a.replies.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("comment-sanitization (security spine)", () => {
  test("escapes all HTML — no stored XSS", () => {
    expect(escapeCommentHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  test("renderCommentHtml escapes markup and never emits a script tag", () => {
    const html = renderCommentHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("only http(s) URLs become live links; javascript:/data: never do", () => {
    expect(isSafeLinkUrl("https://example.com")).toBe(true);
    expect(isSafeLinkUrl("http://example.com")).toBe(true);
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("data:text/html,<script>")).toBe(false);
  });

  test("autolinks carry rel=nofollow ugc noopener noreferrer", () => {
    const html = renderCommentHtml("see https://example.com/x");
    expect(html).toContain('rel="nofollow ugc noopener noreferrer"');
    expect(html).toContain('href="https://example.com/x"');
  });

  test("rejects empty, over-length, and over-linked bodies", () => {
    expect(
      normalizeCommentBody("   ", { maxLength: 100, maxLinks: 2 })
    ).toEqual({
      ok: false,
      reason: "empty"
    });
    expect(
      normalizeCommentBody("x".repeat(101), { maxLength: 100, maxLinks: 2 }).ok
    ).toBe(false);
    const links = "http://a.com http://b.com http://c.com";
    expect(
      normalizeCommentBody(links, { maxLength: 999, maxLinks: 2 })
    ).toEqual({
      ok: false,
      reason: "too_many_links"
    });
  });

  test("countLinks counts bare http(s) urls", () => {
    expect(countLinks("a http://x.com b https://y.com")).toBe(2);
  });
});

describe("anti-abuse", () => {
  const settings = { minSubmitSeconds: 3, blockedTerms: ["viagra", "casino"] };

  test("honeypot blocks a filled hidden field", () => {
    expect(
      evaluateAntiAbuse(
        { honeypotValue: "bot", elapsedMs: 5000, body: "hi" },
        settings
      )
    ).toEqual({ blocked: true, reason: "honeypot" });
  });

  test("timing floor blocks a too-fast submit and missing token", () => {
    expect(
      evaluateAntiAbuse(
        { honeypotValue: "", elapsedMs: 500, body: "hi" },
        settings
      ).blocked
    ).toBe(true);
    expect(
      evaluateAntiAbuse(
        { honeypotValue: "", elapsedMs: null, body: "hi" },
        settings
      )
    ).toEqual({ blocked: true, reason: "too_fast" });
  });

  test("blocked terms matched case-insensitively as substrings", () => {
    expect(containsBlockedTerm("Buy VIAGRA now", ["viagra"])).toBe(true);
    expect(containsBlockedTerm("clean text", ["viagra"])).toBe(false);
    expect(
      evaluateAntiAbuse(
        { honeypotValue: "", elapsedMs: 5000, body: "join our CASINO" },
        settings
      )
    ).toEqual({ blocked: true, reason: "blocked_term" });
  });

  test("duplicate fingerprint is stable per normalized body+author", () => {
    const a = computeContentFingerprint({
      body: "Hello  World",
      authorKey: "k"
    });
    const b = computeContentFingerprint({
      body: "hello world",
      authorKey: "k"
    });
    const c = computeContentFingerprint({
      body: "hello world",
      authorKey: "z"
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("comment-settings validation", () => {
  test("bounds are enforced and merges are partial", () => {
    const r = validateCommentSettings({ maxDepth: 99 });
    expect(r.ok).toBe(false);
    const ok = validateCommentSettings({
      maxDepth: 2,
      requireModeration: false
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.maxDepth).toBe(2);
      expect(ok.value.requireModeration).toBe(false);
    }
  });

  test("rejects an unknown policy mode", () => {
    expect(validateCommentSettings({ defaultPolicyMode: "open" }).ok).toBe(
      false
    );
  });
});

describe("timing token", () => {
  test("verifies a freshly minted token and computes elapsed", () => {
    const t0 = 1_000_000;
    const token = mintTimingToken(t0);
    const v = verifyTimingToken(token, t0 + 5000);
    expect(v.valid).toBe(true);
    if (v.valid) expect(v.elapsedMs).toBe(5000);
  });

  test("rejects a tampered token", () => {
    const token = mintTimingToken(1000) + "x";
    expect(verifyTimingToken(token, 2000).valid).toBe(false);
  });
});

describe("commentable-resource registry", () => {
  test("the live registry validates and blog_content contributes blog_post", () => {
    const result = validateCommentableResourceRegistry(listModules());
    expect(result.valid).toBe(true);
    const keys = result.descriptors.map((d) => d.key);
    expect(keys).toContain("blog_content.post");
  });

  test("rejects a descriptor whose ownerModuleKey mismatches", () => {
    const bad: ModuleDescriptor = {
      key: "x",
      name: "X",
      version: "0.0.0",
      status: "active",
      description: "",
      dependencies: [],
      commentableResources: [
        {
          key: "x.post",
          ownerModuleKey: "not_x",
          resourceType: "post",
          tableName: "awcms_posts",
          localeColumn: "locale",
          slugColumn: "slug",
          urlTemplate: "/p/:slug",
          publicationFilter: { equals: { status: "published" } },
          defaultPolicy: "moderated-anonymous"
        }
      ]
    };
    const result = validateCommentableResourceRegistry([bad]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.message.includes("ownerModuleKey"))
    ).toBe(true);
  });

  test("rejects an unsafe table name", () => {
    const bad: ModuleDescriptor = {
      key: "x",
      name: "X",
      version: "0.0.0",
      status: "active",
      description: "",
      dependencies: [],
      commentableResources: [
        {
          key: "x.post",
          ownerModuleKey: "x",
          resourceType: "post",
          tableName: "posts; DROP TABLE users",
          localeColumn: "locale",
          urlTemplate: "/p/:id",
          publicationFilter: {},
          defaultPolicy: "moderated-anonymous"
        }
      ]
    };
    expect(validateCommentableResourceRegistry([bad]).valid).toBe(false);
  });

  test("collect returns [] for modules with no descriptors", () => {
    expect(collectCommentableResourceDescriptors([])).toEqual([]);
  });
});
