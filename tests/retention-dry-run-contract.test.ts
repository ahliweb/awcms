/**
 * `--dry-run` for the two destructive retention jobs.
 *
 * `form-drafts:purge` physically DELETEs rows; `comments:retention` NULLs
 * author identity columns irreversibly and then DELETEs unconfirmed
 * subscriptions. Both headers claimed they mirrored `audit-log-purge.ts`, which
 * has had a preview since it shipped — they had none, so the only way to learn
 * the first run's blast radius was to take it.
 *
 * Two properties are worth pinning beyond "the flag exists", because getting
 * either wrong makes the preview actively misleading:
 *
 * 1. **The preview and the real path share ONE cutoff function.** Two copies of
 *    `now - days * 86400000` drift the moment one is edited, and a preview that
 *    disagrees with the run it previews is worse than none.
 * 2. **The preview asks the same legal-hold guard.** A held descriptor makes a
 *    real run touch nothing; a preview that ignored the hold would report a
 *    backlog no run would ever act on — the number an operator is most likely
 *    to act on themselves.
 *
 * Text assertions against the real sources, in the shape
 * `tests/sso-break-glass-readiness-contract.test.ts` established: these are
 * call-site facts, and a unit test with a fake `Bun.SQL` would only prove the
 * fake returned what it was told.
 */
import { describe, expect, test } from "bun:test";

import { resolveCommentsRetentionCutoff } from "../src/modules/comments/application/comment-retention";
import { resolveFormDraftRetentionCutoff as formDraftCutoff } from "../src/modules/form-drafts/application/form-draft-purge";

const FORM_DRAFT_MODULE =
  "src/modules/form-drafts/application/form-draft-purge.ts";
const COMMENTS_MODULE = "src/modules/comments/application/comment-retention.ts";

describe("the cutoff is computed in exactly one place per module", () => {
  test("form drafts: the real purge calls the shared resolver", async () => {
    const source = await Bun.file(FORM_DRAFT_MODULE).text();

    expect(source).toContain(
      "const cutoff = resolveFormDraftRetentionCutoff(now, retentionDays);"
    );
    // The arithmetic must survive in exactly ONE place — inside the resolver.
    // A second copy anywhere means the shared function is decoration.
    expect(
      source.match(
        /now\.getTime\(\) - retentionDays \* 24 \* 60 \* 60 \* 1000/g
      )
    ).toHaveLength(1);
  });

  test("comments: both sweeps call the shared resolver", async () => {
    const source = await Bun.file(COMMENTS_MODULE).text();
    const calls = source.match(/resolveCommentsRetentionCutoff\(/g) ?? [];

    // Definition + anonymize + subscription purge + two in the preview.
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(
      source.match(
        /now\.getTime\(\) - retentionDays \* 24 \* 60 \* 60 \* 1000/g
      )
    ).toHaveLength(1);
  });

  test("the resolvers agree with the arithmetic they replaced", () => {
    const now = new Date("2026-07-27T00:00:00.000Z");

    expect(formDraftCutoff(now, 30).toISOString()).toBe(
      "2026-06-27T00:00:00.000Z"
    );
    expect(resolveCommentsRetentionCutoff(now, 365).toISOString()).toBe(
      "2025-07-27T00:00:00.000Z"
    );
  });
});

describe("the preview respects the legal hold the real run respects", () => {
  test("comments: previewCommentsRetention asks the guard and reports it", async () => {
    const source = await Bun.file(COMMENTS_MODULE).text();
    const preview = source.slice(source.indexOf("previewCommentsRetention"));

    expect(preview).toContain("legalHoldGuard.isDescriptorHeld(");
    expect(preview).toContain("COMMENTS_CONTENT_LIFECYCLE_KEY");
    // Reported, not merely consulted: an operator has to be able to tell
    // "nothing to do" apart from "held".
    expect(preview).toContain("skippedForLegalHold: held");
  });

  test("form drafts: countPurgeableFormDrafts takes the guard and returns 0 when held", async () => {
    const source = await Bun.file(FORM_DRAFT_MODULE).text();
    const counter = source.slice(source.indexOf("countPurgeableFormDrafts"));

    expect(counter).toContain("legalHoldGuard.isDescriptorHeld(");
    expect(counter).toContain("FORM_DRAFTS_LIFECYCLE_KEY");
    expect(counter).toContain("return 0;");
  });
});

describe("the scripts expose the flag and change nothing under it", () => {
  test.each([
    ["scripts/form-draft-purge.ts", "form-drafts:purge DRY RUN"],
    ["scripts/comments-retention.ts", "comments:retention DRY RUN"]
  ])("%s", async (path, banner) => {
    const source = await Bun.file(path).text();

    expect(source).toContain('process.argv.includes("--dry-run")');
    expect(source).toContain(banner);
    expect(source).toContain("(nothing was changed)");
  });

  test("neither script still claims to mirror a job it does not resemble", async () => {
    // Both headers said they mirrored `audit-log-purge.ts`, which uses
    // `runJob` — advisory lock, telemetry, cooperative cancellation. Neither
    // does. A reader who believed the claim would assume protections that are
    // not there, so the claim is replaced by a statement of what IS missing.
    for (const path of [
      "scripts/form-draft-purge.ts",
      "scripts/comments-retention.ts"
    ]) {
      const header = (await Bun.file(path).text()).split("*/")[0]!;

      expect(header).not.toMatch(/mirroring\s+`?scripts\/audit-log-purge/);
      expect(header).toContain("does NOT go through `runJob`");
      expect(header).toContain("ONE cron entry");
    }
  });
});
