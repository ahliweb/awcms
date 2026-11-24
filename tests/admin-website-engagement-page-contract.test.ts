/**
 * `/admin/website-engagement`, `/admin/website-engagement/[id]` and
 * `/admin/website-engagement/sources` gate against the endpoints they drive
 * (Issue #1153, ADR-0155 section 8, ADR-0149).
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE,
 * the owner included, while still looking like a working screen. The properties
 * pinned here are the ones the issue makes load-bearing:
 *
 * - every permission the screens name is DECLARED, SEEDED and ENFORCED by the
 *   endpoint behind the control, and the navigation entries open pages that
 *   exist on keys the pages accept;
 * - the screens read through the loaders, which call the ROUTES' OWN directory
 *   functions, and never decrypt (no reveal, no key ring), never select a
 *   token or its hash, and hold no SQL;
 * - every mutation the scripts send is a real endpoint, and the withdrawal
 *   carries an `Idempotency-Key`;
 * - the scripts are bundled (they import a module, so CSP allows them).
 *
 * Pure: no database, no network. The tenant isolation and the restricted
 * viewer are measured against a real database in
 * `tests/integration/website-engagement-screens.integration.test.ts`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { stripComments } from "../scripts/lib/source-text";
import { WEBSITE_ENGAGEMENT_GUARDS } from "../src/modules/website-engagement/domain/website-engagement-constants";

const LIST_PAGE = "src/pages/admin/website-engagement.astro";
const DETAIL_PAGE = "src/pages/admin/website-engagement/[id].astro";
const SOURCES_PAGE = "src/pages/admin/website-engagement/sources.astro";
/** Comments stripped: the docblocks name the very things the screens must not do. */
const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const list = read(LIST_PAGE);
const detail = read(DETAIL_PAGE);
const sources = read(SOURCES_PAGE);
const loaders = read(
  "src/modules/website-engagement/application/screen-loaders.ts"
);

/** The literal guard a page spells out, so the coverage gate (which reads source text) sees it. */
function literalGuard(source: string, name: string) {
  const match = new RegExp(
    `const ${name} = \\{\\s*moduleKey: "([a-z_]+)",\\s*activityCode: "([a-z_]+)",\\s*action: "([a-z_]+)"\\s*\\} as const;`
  ).exec(source);

  expect(match).not.toBeNull();

  return { moduleKey: match![1], activityCode: match![2], action: match![3] };
}

describe("the screens gate on keys that really exist", () => {
  const G = WEBSITE_ENGAGEMENT_GUARDS;

  test("each literal guard equals the module's own guard constant", () => {
    expect(literalGuard(list, "READ_GUARD")).toEqual(G.readSubmissions);
    expect(literalGuard(list, "SOURCES_READ_GUARD")).toEqual(G.readSources);
    expect(literalGuard(detail, "READ_GUARD")).toEqual(G.readSubmissions);
    expect(literalGuard(detail, "WITHDRAW_GUARD")).toEqual(
      G.withdrawSubmissions
    );
    expect(literalGuard(detail, "REVEAL_GUARD")).toEqual(G.revealSubmissions);
    expect(literalGuard(sources, "READ_GUARD")).toEqual(G.readSources);
    expect(literalGuard(sources, "MANAGE_GUARD")).toEqual(G.manageSources);
  });

  test("every key is DECLARED by the module and SEEDED by the migration", () => {
    const module = listModules().find((m) => m.key === "website_engagement")!;
    const declared = new Set(
      (module.permissions ?? []).map(
        (permission) =>
          `${module.key}.${permission.activityCode}.${permission.action}`
      )
    );
    const seed = read("sql/326_awcms_website_engagement_permissions.sql");

    for (const guard of Object.values(G)) {
      expect(
        declared.has(`${guard.moduleKey}.${guard.activityCode}.${guard.action}`)
      ).toBe(true);
      expect(seed).toContain(
        `'${guard.moduleKey}', '${guard.activityCode}', '${guard.action}'`
      );
    }
  });

  test("each endpoint enforces the key the screen assumes", () => {
    const base = "src/pages/api/v1/website-engagement";
    const expectations: [string, string][] = [
      [
        `${base}/submissions/index.ts`,
        "WEBSITE_ENGAGEMENT_GUARDS.readSubmissions"
      ],
      [
        `${base}/submissions/[id]/index.ts`,
        "WEBSITE_ENGAGEMENT_GUARDS.readSubmissions"
      ],
      [
        `${base}/submissions/[id]/withdraw.ts`,
        "WEBSITE_ENGAGEMENT_GUARDS.withdrawSubmissions"
      ],
      [
        `${base}/submissions/[id]/reveal.ts`,
        "WEBSITE_ENGAGEMENT_GUARDS.revealSubmissions"
      ],
      [`${base}/sources/index.ts`, "WEBSITE_ENGAGEMENT_GUARDS.readSources"],
      [
        `${base}/sources/[id]/revoke.ts`,
        "WEBSITE_ENGAGEMENT_GUARDS.manageSources"
      ]
    ];

    for (const [route, guard] of expectations) {
      expect(read(route)).toContain(guard);
    }
  });

  test("the sidebar entries open real pages on the key each page accepts", () => {
    const module = listModules().find((m) => m.key === "website_engagement")!;

    expect(module.status).toBe("active");
    expect(module.navigation).toEqual([
      expect.objectContaining({
        path: "/admin/website-engagement",
        requiredPermission: "website_engagement.submissions.read"
      }),
      expect.objectContaining({
        path: "/admin/website-engagement/sources",
        requiredPermission: "website_engagement.sources.read"
      })
    ]);
    expect(list).toContain("authorize: READ_GUARD");
    expect(detail).toContain("authorize: READ_GUARD");
    expect(sources).toContain("authorize: READ_GUARD");
  });

  test("a control is shown only when the chokepoint allows its permission", () => {
    expect(detail).toContain("withdrawGuard: WITHDRAW_GUARD");
    expect(detail).toContain("revealGuard: REVEAL_GUARD");
    expect(loaders).toContain("await can(input.revealGuard)");
    // The reveal affordance also requires a received contact/lead.
    expect(loaders).toContain('submission.kind !== "interaction"');
    expect(detail).toContain("found.canReveal &&");
    expect(sources).toContain("manageGuard: MANAGE_GUARD");
    expect(list).toContain("readSourcesGuard: SOURCES_READ_GUARD");
    expect(loaders).toContain("await can(input.withdrawGuard)");
    expect(loaders).toContain("await can(input.manageGuard)");
    expect(loaders).toContain("await can(input.readSourcesGuard)");
    // The withdraw affordance also requires a submission still `received`.
    expect(loaders).toContain('submission.status === "received"');

    for (const source of [list, detail, sources, loaders]) {
      // Never raw RBAC: that skips ABAC and module state.
      expect(source).not.toContain("ssr.permissions.has");
    }
  });

  test("the loaders run only inside loadAdminScreen, after authorization", () => {
    for (const source of [list, detail, sources]) {
      expect(source.search(/\bload(Submission|Source)\w+\(/)).toBeGreaterThan(
        source.indexOf("await loadAdminScreen(")
      );
    }
  });
});

describe("the screens read through the routes' own functions and show no secret", () => {
  test("listing and reads are the API's directory functions, with no SQL in the page", () => {
    for (const source of [list, detail, sources]) {
      expect(source).not.toMatch(
        /listSubmissions|fetchSubmission|listSources|\btx`/
      );
      expect(source).not.toContain("awcms_engagement_");
    }

    expect(loaders).toContain("listSubmissions(");
    expect(loaders).toContain("fetchSubmission(");
    expect(loaders).toContain("listSources(");
    expect(loaders).toContain("validateListSubmissionsQuery(");
    expect(loaders).toContain("LOAD_PAGE_LIMIT = 2");
    // The query is parsed BEFORE the load that needs it.
    expect(list.indexOf("parseDataPageQuery(")).toBeLessThan(
      list.indexOf("await loadAdminScreen(")
    );
  });

  test("nothing decrypts or selects a token, a hash or a key; only the detail script may POST the reveal endpoint", () => {
    for (const source of [list, detail, sources, loaders]) {
      expect(source).not.toMatch(
        /revealSubmission|decryptField|contact_encrypted|token_hash|tokenHash\b.*source|email_hash|phone_hash|KeyRing/
      );
      expect(source).not.toMatch(/resolveWebsiteEngagementRings\(\)\.rings/);
    }

    for (const source of [list, sources, loaders]) {
      expect(source).not.toMatch(/\/reveal\b/);
    }

    // On the detail page the endpoint is named only INSIDE the script, never in
    // the server-rendered markup.
    expect(detail.slice(0, detail.indexOf("<script>"))).not.toMatch(
      /\/reveal\b/
    );
  });

  test("only masked projections reach the markup", () => {
    expect(list).toContain("emailMasked");
    expect(detail).toContain("emailMasked");
    expect(sources).toContain("tokenPrefix");

    for (const source of [list, detail, sources]) {
      expect(source).not.toMatch(
        /\bsubmission\.(email|phone|message|name|contact)\b/
      );
    }
  });

  test("an unknown, foreign or malformed id is one 'not found' answer", () => {
    expect(detail).toContain("website-engagement-not-found");
    expect(loaders).toContain(
      "if (!isUuid(submissionId)) return { found: false }"
    );
    // The page hands over the RAW parameter; normalising is the loader's job.
    expect(detail).toContain("submissionId: rawId");
  });
});

describe("the actions", () => {
  test("withdraw posts to the withdraw endpoint with an Idempotency-Key after a confirmation", () => {
    const script = detail.slice(detail.indexOf("<script>"));

    expect(script).toContain("/submissions/${id}/withdraw");
    expect(script).toContain('"Idempotency-Key"');
    expect(script).toContain("confirmAction(");
    expect(script).not.toContain("localStorage");
    expect(script).not.toContain("sessionStorage");
  });

  test("revoke posts to the revoke endpoint after a confirmation and is the only source action", () => {
    const script = sources.slice(sources.indexOf("<script>"));

    expect(script).toContain("/sources/${id}/revoke");
    expect(script).toContain("confirmAction(");
    // Create, edit, pause and rotate need a one-time token display: API-only.
    expect(script).not.toMatch(/\/rotate|"PATCH"|"DELETE"|"PUT"/);
    expect(sources).not.toMatch(/<form/);
  });

  test("scripts import a module, so Astro bundles them under the CSP", () => {
    for (const source of [detail, sources]) {
      const script = source.slice(source.indexOf("<script>"));

      expect(script).toContain('from "../../../lib/ui/admin-form-client"');
    }
  });
});

describe("the reveal (Issue #1477)", () => {
  const script = detail.slice(detail.indexOf("<script>"));
  const markup = detail.slice(0, detail.indexOf("<script>"));

  test("it is an explicit, confirmed POST to the audited endpoint, one request per click", () => {
    expect(script).toContain("/submissions/${encodeURIComponent(id)}/reveal");
    expect(script).toContain('"POST"');
    expect(script).toContain("confirmAction(");
    expect(script).toContain('onAction("#website-engagement-reveal-button"');
    // No Idempotency-Key: a replay would skip the audit row or keep PII.
    const revealPart = script.slice(script.indexOf("The REVEAL."));
    expect(revealPart.slice(0, revealPart.indexOf("onSubmit("))).not.toContain(
      "Idempotency-Key"
    );
  });

  test("the value reaches the page as TEXT only and is never stored", () => {
    expect(script).toContain("detail.textContent = value");
    expect(script).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    expect(script).not.toContain("localStorage");
    expect(script).not.toContain("sessionStorage");
    expect(script).not.toContain("setAttribute(");
  });

  test("the panel is emptied on Hide, after a timeout and on pagehide", () => {
    expect(script).toContain("revealFields?.replaceChildren()");
    expect(script).toContain(
      "window.setTimeout(hideRevealed, REVEAL_VISIBLE_MS)"
    );
    expect(script).toContain('window.addEventListener("pagehide"');
    expect(script).toContain('"website-engagement-reveal-hide"');
  });

  test("the markup is masked by default: no panel content and no value is rendered on the server", () => {
    expect(markup).toContain('id="website-engagement-reveal-panel"');
    expect(markup).toMatch(
      /id="website-engagement-reveal-panel"[^>]*\bhidden\b/
    );
    expect(markup).not.toMatch(
      /\bsubmission\.(email|phone|message|name|contact)\b/
    );
  });

  test("a11y: a persistent live region, a focusable panel, labelled controls", () => {
    expect(markup).toMatch(
      /id="website-engagement-reveal-status"[\s\S]{0,80}role="status"/
    );
    expect(markup).toContain(
      'aria-labelledby="website-engagement-reveal-title"'
    );
    expect(markup).toMatch(
      /id="website-engagement-reveal-panel"[\s\S]{0,60}tabindex="-1"/
    );
    expect(script).toContain("revealButton.focus()");
    expect(script).toContain("revealPanel.focus()");
  });

  test("it left the NOT_YET_SCREENED ledger", () => {
    expect(read("scripts/admin-screen-coverage-ledger.ts")).not.toContain(
      "website_engagement.submissions.reveal"
    );
  });
});

describe("the screens are ADR-0149 data pages", () => {
  test("the list uses the four shared primitives and the URL contract", () => {
    for (const component of [
      "DataListToolbar",
      "DataEmptyState",
      "SortableHeader",
      "KeysetPager"
    ]) {
      expect(list).toContain(`<${component}`);
    }

    expect(list).toContain("sliceKeyset(");
    expect(list).toContain('role="region"');
    expect(list).toContain('tabindex="0"');
  });

  test("the list's total is only shown when it is exact", () => {
    expect(list).toContain("total={data.more ? undefined : page.total}");
  });
});
