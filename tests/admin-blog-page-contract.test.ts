/**
 * `/admin/blog` gates against the endpoints it drives, and is explicit about
 * the permissions it deliberately does NOT drive.
 *
 * Sibling of the four other admin page contracts. What is specific here is
 * scale: `blog_content` declares 43 permissions across 15 activity codes, so
 * for the first time "the page drives all of them" is the WRONG assertion. The
 * useful one is that every gate is real, and that the absences are the ones
 * intended.
 *
 * Three module-specific traps:
 *
 * - **`submit-review` is gated on `posts.update`.** It reads like it wants a
 *   `posts.submit` or `posts.review`; neither is seeded anywhere, so inventing
 *   one would hide the button from every editor including the owner. The route
 *   builds its guard in two pieces (an `ACTIVITY` const plus a literal
 *   `action`), so a regex over guard triples cannot see it — this test asserts
 *   it directly rather than letting it pass as unenforced.
 * - **`posts.export` is declared and seeded, and has NO route at all.** A
 *   screen cannot drive a permission with no surface; a control gated on it
 *   would issue a request that 404s.
 * - **`POST /api/v1/blog/posts` requires no `Idempotency-Key` by documented
 *   design**, while six sibling mutations do. Sending one to create would
 *   imply a replay contract the endpoint declined on purpose.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/blog.astro";
const POSTS_ROUTE = "src/pages/api/v1/blog/posts/index.ts";
const POST_ITEM_ROUTE = "src/pages/api/v1/blog/posts/[id].ts";
const SUBMIT_ROUTE = "src/pages/api/v1/blog/posts/[id]/submit-review.ts";
const REVISION_RESTORE_ROUTE =
  "src/pages/api/v1/blog/posts/[id]/revisions/[revisionId]/restore.ts";

/** Every route this page calls. */
const ROUTES = [
  POSTS_ROUTE,
  POST_ITEM_ROUTE,
  SUBMIT_ROUTE,
  "src/pages/api/v1/blog/posts/[id]/publish.ts",
  "src/pages/api/v1/blog/posts/[id]/schedule.ts",
  "src/pages/api/v1/blog/posts/[id]/archive.ts",
  "src/pages/api/v1/blog/posts/[id]/restore.ts",
  "src/pages/api/v1/blog/posts/[id]/purge.ts",
  "src/pages/api/v1/blog/posts/[id]/revisions/index.ts",
  REVISION_RESTORE_ROUTE
];

/** The six that answer `IDEMPOTENCY_REQUIRED` without the header. */
const IDEMPOTENT_ROUTES = [
  "src/pages/api/v1/blog/posts/[id]/publish.ts",
  "src/pages/api/v1/blog/posts/[id]/schedule.ts",
  "src/pages/api/v1/blog/posts/[id]/archive.ts",
  "src/pages/api/v1/blog/posts/[id]/restore.ts",
  "src/pages/api/v1/blog/posts/[id]/purge.ts",
  REVISION_RESTORE_ROUTE
];

const PAGE_KEYS = [
  "blog_content.posts.archive",
  "blog_content.posts.create",
  "blog_content.posts.delete",
  "blog_content.posts.publish",
  "blog_content.posts.purge",
  "blog_content.posts.read",
  "blog_content.posts.restore",
  "blog_content.posts.schedule",
  "blog_content.posts.update",
  "blog_content.revisions.read",
  "blog_content.revisions.restore"
] as const;

type Triple = `${string}.${string}.${string}`;

function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

/**
 * Both spellings, and issue #450 is why the second exists: a screen routed
 * through `loadAdminScreen` states its guards as `AccessRequest` object
 * literals — the SAME shape the routes use — instead of `permissionKey(...)`.
 *
 * Reading only the old spelling would have made this test demand the screen
 * keep deciding access from the raw grant set, which is the defect. A contract
 * test must pin the PROPERTY (this screen gates exactly the eleven), never the
 * syntax that happened to express it.
 */
function pageTriplesFrom(source: string): Set<Triple> {
  const found = guardTriplesFrom(source);
  const pattern =
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "blog_content")
      ?.permissions?.map(
        (permission) =>
          `blog_content.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

describe("/admin/blog permission gates", () => {
  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    expect(pageKeys.size).toBe(PAGE_KEYS.length);

    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Guards really were parsed — an empty `enforced` would make the subset
    // check pass vacuously, the shape of gate this repo has been burned by.
    expect(enforced.size).toBeGreaterThan(0);

    // `posts.update` is enforced in two pieces (an `ACTIVITY` const plus a
    // literal `action`), which the triple regex cannot see. Assert it directly
    // rather than letting it fall through as unenforced.
    const submit = await readFile(SUBMIT_ROUTE, "utf8");
    expect(submit).toContain('moduleKey: "blog_content"');
    expect(submit).toContain('activityCode: "posts"');
    expect(submit).toContain('action: "update"');
    enforced.add("blog_content.posts.update");

    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = declaredTriples();
    // 43 until ADR-0058 §C/§D revoked `seo.configure` and `posts.export`
    // (`sql/089`), leaving 41. Now 47: sql/131-132 added the institution
    // registry, whose six actions (`read`/`create`/`update`/`delete`/
    // `restore`/`purge`) are gated separately from `taxonomies.*` because an
    // institution owns a public landing page with its own SEO metadata. The
    // number is pinned rather than derived so that a permission appearing or
    // vanishing has to be a decision someone edits this line for.
    expect(declared.size).toBe(47);

    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("the page claims exactly the post-lifecycle eleven", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));

    // Enumerated, so a permission quietly appearing on this page — instead of
    // on the sibling screen that should own it — fails here loudly.
    expect([...pageKeys].sort()).toEqual([...PAGE_KEYS]);
  });

  test("submit-review is gated on posts.update — there is no posts.submit", () => {
    const declared = declaredTriples();

    expect(declared.has("blog_content.posts.update" as Triple)).toBe(true);
    expect(declared.has("blog_content.posts.submit" as Triple)).toBe(false);
    expect(declared.has("blog_content.posts.review" as Triple)).toBe(false);
  });

  test("posts.export is REVOKED — undeclared, unseeded, unenforced, ungated", async () => {
    const declared = declaredTriples();
    const page = await readFile(PAGE, "utf8");

    // This test used to assert the opposite — declared and seeded with no
    // enforcer — and recorded that state as a deliberate absence. ADR-0058 §D
    // ended it: there was no export machinery anywhere in the repo, so the
    // catalogue row promised authority over an action that could not be
    // performed, granted to every tenant owner by `setup/initialize`.
    expect(declared.has("blog_content.posts.export" as Triple)).toBe(false);

    // `sql/036` still contains the original seed — an applied migration is
    // immutable — so the revocation is a NEW migration, and it is the one that
    // must be present.
    expect(
      await readFile(
        "sql/089_awcms_blog_content_revoke_seo_export_permissions.sql",
        "utf8"
      )
    ).toContain("'export'");

    // Still enforced by nothing, proven by scanning EVERY blog route rather
    // than trusting the descriptor: an export endpoint appearing without its
    // permission being re-declared would be an ungated surface, which is the
    // worse half of the defect this whole ADR is about.
    const enforced = new Set<Triple>();
    for await (const file of new Bun.Glob("src/pages/api/v1/blog/**/*.ts").scan(
      {
        cwd: process.cwd()
      }
    )) {
      for (const triple of guardTriplesFrom(await readFile(file, "utf8"))) {
        enforced.add(triple);
      }
    }
    expect(enforced.size).toBeGreaterThan(5);
    expect(enforced.has("blog_content.posts.export" as Triple)).toBe(false);

    // So the page must not gate anything on it.
    expect(
      pageTriplesFrom(page).has("blog_content.posts.export" as Triple)
    ).toBe(false);
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch, so
    // the endpoints' audit rows and idempotency records cannot be bypassed.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );

    expect(page).toContain('"/api/v1/blog/posts"');
    expect(page).toContain("/api/v1/blog/posts/${id}/publish`");
    expect(page).toContain("/api/v1/blog/posts/${id}/schedule`");
    expect(page).toContain("/api/v1/blog/posts/${id}/archive`");
    expect(page).toContain("/api/v1/blog/posts/${id}/restore`");
    expect(page).toContain("/api/v1/blog/posts/${id}/purge`");
    expect(page).toContain("/api/v1/blog/posts/${id}/submit-review`");
    expect(page).toContain("/api/v1/blog/posts/${postId}`");
    expect(page).toContain(
      "/api/v1/blog/posts/${postId}/revisions/${revisionId}/restore`"
    );
  });

  test("create sends no Idempotency-Key, because that endpoint requires none", async () => {
    const page = await readFile(PAGE, "utf8");

    // Scoped to the create request, so adding a header there turns this red
    // while the six legitimate ones stay untouched.
    const createCall = page.slice(page.indexOf('"/api/v1/blog/posts"'));
    expect(createCall.slice(0, createCall.indexOf(");"))).not.toContain(
      "Idempotency-Key"
    );

    // And the endpoint really does decline one — the page's choice is only
    // correct while that stays true.
    expect(await readFile(POSTS_ROUTE, "utf8")).not.toContain(
      "IDEMPOTENCY_REQUIRED"
    );
    expect(await readFile(POST_ITEM_ROUTE, "utf8")).not.toContain(
      "IDEMPOTENCY_REQUIRED"
    );
    expect(await readFile(SUBMIT_ROUTE, "utf8")).not.toContain(
      "IDEMPOTENCY_REQUIRED"
    );
  });

  test("the six lifecycle mutations that require a key are sent one", async () => {
    const page = await readFile(PAGE, "utf8");

    for (const route of IDEMPOTENT_ROUTES) {
      expect(await readFile(route, "utf8")).toContain("IDEMPOTENCY_REQUIRED");
    }

    // The page routes them through one helper plus the revision-restore call,
    // so the header is spelled once and applied by default — `idempotent:
    // false` is the explicit opt-out for submit-review.
    expect(page).toContain('"Idempotency-Key": crypto.randomUUID()');
    expect(page).toContain("idempotent: false");
  });

  test("form bounds come from the constants the validator enforces", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("MAX_TITLE_LENGTH");
    expect(page).toContain("MAX_EXCERPT_LENGTH");
    // A hand-typed `maxlength` drifts into a browser accepting what the server
    // rejects with a 400 the author cannot act on.
    expect(page).not.toMatch(/maxlength=\{?"?\d/);

    const validation = await readFile(
      "src/modules/blog-content/domain/content-validation.ts",
      "utf8"
    );
    expect(validation).toContain("export const MAX_TITLE_LENGTH");
    expect(validation).toContain("export const MAX_EXCERPT_LENGTH");

    // Issue #595 — the SEO bounds are exported for the same reason, so the
    // form cannot accept a 90-character SEO title the server then refuses.
    expect(page).toContain("MAX_SEO_TITLE_LENGTH");
    expect(page).toContain("MAX_META_DESCRIPTION_LENGTH");

    const seoValidation = await readFile(
      "src/modules/blog-content/domain/seo-validation.ts",
      "utf8"
    );
    expect(seoValidation).toContain("export const MAX_SEO_TITLE_LENGTH");
    expect(seoValidation).toContain("export const MAX_META_DESCRIPTION_LENGTH");
  });

  test("the SEO fields exist on BOTH forms, or an article can only ever get them once", async () => {
    const page = await readFile(PAGE, "utf8");

    for (const id of [
      "create-seo-title",
      "create-meta-description",
      "create-canonical-url",
      "edit-seo-title",
      "edit-meta-description",
      "edit-canonical-url"
    ]) {
      expect(page).toContain(id);
    }
  });

  test("create OMITS an empty SEO field while edit sends null — the asymmetry is the point", async () => {
    const page = await readFile(PAGE, "utf8");

    // Absent and `null` mean different things to these two endpoints. On
    // create, absent is "none" and `seoTitle: ""` is refused outright, so a
    // blank field must not be sent. On PATCH, absent is "leave unchanged", so
    // a blank field MUST be sent as `null` or the fields become write-once and
    // a wrong meta description can never be deleted.
    expect(page).toContain('if (value !== "") body[name] = value;');
    expect(page).toContain('seoTitle: field(data, "seoTitle") || null');
    expect(page).toContain(
      'metaDescription: field(data, "metaDescription") || null'
    );
    expect(page).toContain('canonicalUrl: field(data, "canonicalUrl") || null');
  });

  test("the featured-image picker adds NO server-side gate to this screen", async () => {
    const page = await readFile(PAGE, "utf8");

    // The catalogue is read from the browser against a guarded endpoint, so
    // this screen still holds `blog_content.posts.*` and nothing else. If a
    // `can({ moduleKey: "media_library" ... })` ever appears here, the
    // eleven-key contract above fails too — this names the reason.
    expect(page).not.toContain('moduleKey: "media_library"');
    expect(page).toContain("wireMediaPickers");
  });

  test("the picker offers only verified, undeleted objects", async () => {
    const picker = await readFile("src/lib/ui/media-picker-client.ts", "utf8");

    // Both halves. `verified` is the set that passed the finalize pipeline;
    // `deletion=live` because a soft-deleted object can still be verified
    // while every reference to it has stopped resolving.
    expect(picker).toContain("status=verified");
    expect(picker).toContain("deletion=live");
  });

  test("featuredMediaId is sent as null on BOTH forms, so a wrong photo can be detached", async () => {
    const page = await readFile(PAGE, "utf8");

    const occurrences = page.match(
      /featuredMediaId = field\(data, "featuredMediaId"\) \|\| null|featuredMediaId: field\(data, "featuredMediaId"\) \|\| null/g
    );

    expect(occurrences?.length).toBe(2);
  });

  test("the term picker adds NO server-side gate either", async () => {
    const page = await readFile(PAGE, "utf8");

    // Same resolution as the media picker: the vocabulary is read from the
    // browser against an endpoint that enforces `taxonomies.read` itself, so
    // this screen never borrows it. `fetchPostTermIds` IS a server read, but
    // it touches only the join table for the post already being edited under
    // `posts.update` — it reads no taxonomy the editor could not already see.
    expect(page).not.toContain('activityCode: "taxonomies"');
    expect(page).toContain("fetchPickableTerms");
  });

  test("termIds is omitted when the vocabulary failed to load, never sent as []", async () => {
    const page = await readFile(PAGE, "utf8");

    // The defect this prevents is silent: absent means "leave assignments
    // alone", `[]` means "remove them all". A failed fetch that sent `[]`
    // would strip every category on the next save with no error anywhere.
    expect(page).toContain('host.dataset.failed = "true"');
    expect(page).toContain(
      'if (host.dataset.failed === "true") return undefined'
    );
    expect(page).toContain("if (createTermIds !== undefined) body.termIds");
    expect(page).toContain("if (editTermIds !== undefined) body.termIds");
  });

  test("a server-side SEO field error maps to the label above the input", async () => {
    const page = await readFile(PAGE, "utf8");

    // Without these the operator is told `metaDescription` is wrong, which is
    // not what any label on the page says.
    expect(page).toContain('seoTitle: "SEO title"');
    expect(page).toContain('metaDescription: "Meta description"');
    expect(page).toContain('canonicalUrl: "Canonical URL"');
  });

  test("Restore is gated on the bin view, not on archived status", async () => {
    const page = await readFile(PAGE, "utf8");

    // The original defect: `{canRestore && post.status === "archived" && (`.
    // Archived is not soft-deleted, and `POST .../restore` requires
    // `canRestorePost` (`deleted_at IS NOT NULL`), so the control was rendered
    // exactly where it must 404.
    expect(page).not.toMatch(
      /canRestore\s*&&\s*post\.status\s*===\s*"archived"/
    );
    expect(page).toMatch(/canRestore\s*&&\s*showsBin/);

    // And the endpoint really does demand a soft-deleted row, which is the
    // only reason the line above is the correct one.
    const restore = await readFile(
      "src/pages/api/v1/blog/posts/[id]/restore.ts",
      "utf8"
    );
    expect(restore).toContain("canRestorePost");
    expect(restore).toContain("includeDeleted: true");
  });

  test("the bin is reachable, so a restorable post can actually be on screen", async () => {
    const page = await readFile(PAGE, "utf8");
    const directory = await readFile(
      "src/modules/blog-content/application/blog-post-directory.ts",
      "utf8"
    );

    // A `deletedOnly` filter nothing passes would leave the bin unreachable
    // and Restore undrivable for a second time, one layer down.
    expect(directory).toContain("deletedOnly?: boolean");
    expect(directory).toMatch(/CASE WHEN \$\{deletedOnly\}/);
    expect(page).toContain("deletedOnly: showsBin || undefined");
    expect(page).toContain('readParam("view") === "deleted"');
  });

  test("a soft-deleted post is offered no lifecycle transition", async () => {
    const page = await readFile(PAGE, "utf8");

    // `transitionBlogPostStatus` matches `deleted_at IS NULL`, so publish,
    // schedule, archive and submit-for-review all 404 on a binned post.
    // Matched with `\s*` because prettier wraps these JSX conditions across
    // lines — an exact-string assertion here reads as a behaviour change the
    // next time a condition grows a clause.
    for (const control of [
      "canUpdate",
      "canPublish",
      "canSchedule",
      "canArchive",
      // Delete too — it is already deleted.
      "canDelete"
    ]) {
      expect(page).toMatch(
        new RegExp(String.raw`\{${control}\s*&&\s*!showsBin\s*&&`)
      );
    }

    // Purge is the deliberate exception: `canPurgePost` accepts either state.
    expect(page).toMatch(
      /canPurge\s*&&\s*\(showsBin\s*\|\|\s*post\.status\s*===\s*"archived"\)/
    );
  });

  test("the sidebar entry points at this page and is gated on a real permission", () => {
    const nav = listModules()
      .find((module) => module.key === "blog_content")
      ?.navigation?.find((entry) => entry.path === "/admin/blog");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("blog_content.posts.read");
    expect(declaredTriples().has(nav!.requiredPermission as Triple)).toBe(true);

    // The count is pinned so each arrival is a line somebody edits
    // deliberately, which is what this assertion forced when
    // `/admin/blog-settings` landed and again when `/admin/blog-institutions`
    // did. An entry appearing here without a page is what
    // `admin-navigation-registry.test.ts` catches.
    const navigation = listModules().find(
      (module) => module.key === "blog_content"
    )?.navigation;

    // 7 since Issue #594: `/admin/blog-homepage` joined posts, pages, taxonomy,
    // institutions, presentation and settings. That comment used to predict
    // this arrival ("homepage composition still brings its own entry when its
    // page lands"); it has landed, and ad inventory is the next one due.
    expect(navigation).toHaveLength(7);
    expect(navigation?.map((entry) => entry.path).sort()).toEqual([
      "/admin/blog",
      "/admin/blog-homepage",
      "/admin/blog-institutions",
      "/admin/blog-pages",
      "/admin/blog-presentation",
      "/admin/blog-settings",
      "/admin/blog-taxonomy"
    ]);

    // Gated on their OWN permissions: an operator granted one and not the
    // others must see exactly the screens they can use.
    const pagesEntry = navigation?.find(
      (entry) => entry.path === "/admin/blog-pages"
    );
    expect(pagesEntry?.requiredPermission).toBe("blog_content.pages.read");

    const taxonomyEntry = navigation?.find(
      (entry) => entry.path === "/admin/blog-taxonomy"
    );
    expect(taxonomyEntry?.requiredPermission).toBe(
      "blog_content.taxonomies.read"
    );

    const presentationEntry = navigation?.find(
      (entry) => entry.path === "/admin/blog-presentation"
    );
    expect(presentationEntry?.requiredPermission).toBe(
      "blog_content.templates.read"
    );
  });
});
