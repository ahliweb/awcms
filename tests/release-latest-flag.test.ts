/**
 * ADR-0119 — the "Latest" badge is DECIDED, never inherited.
 *
 * `gh release create` without `--latest` uses GitHub's default, which assumes
 * releases only ever move forward. This repo breaks that assumption by design:
 * the `release` environment gate can hold a run for days, so a release can
 * publish out of version order. On 28 August 2026 that happened for real —
 * approving the parked `v10.0.0`/`v10.0.1` runs moved the badge off `v10.0.4`
 * and onto a version four releases stale.
 *
 * The first test below is that incident, replayed. It is written from the tag
 * list as it actually stood, not from an invented example, because the whole
 * reason the defect survived a day was that a plausible-looking reading of the
 * evidence said it could not happen.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { decideFromRawInput } from "../scripts/release-latest-flag";
import {
  shouldMarkReleaseLatest,
  type PublishedRelease
} from "../scripts/lib/release-verify-checks";

/** The published set at the moment the three parked runs were approved. */
const AS_IT_STOOD: PublishedRelease[] = [
  { tagName: "v10.0.4" },
  { tagName: "v10.0.3" },
  { tagName: "v10.0.2" },
  { tagName: "v9.1.2" },
  { tagName: "v9.1.1" },
  { tagName: "v9.1.0" },
  { tagName: "v9.0.0" },
  { tagName: "v8.0.0" },
  { tagName: "v7.0.1" },
  { tagName: "v5.1.0", isPrerelease: true },
  { tagName: "v4.6.0", isPrerelease: true }
];

describe("the Latest badge is decided, not inherited", () => {
  test("the 28 August incident: a backfilled release is REFUSED the badge", () => {
    // Every one of these published while v10.0.4 already existed. Under the
    // inherited default all three took the badge; under the rule none may.
    expect(shouldMarkReleaseLatest("v10.0.0", AS_IT_STOOD)).toBe(false);
    expect(shouldMarkReleaseLatest("v10.0.1", AS_IT_STOOD)).toBe(false);
    expect(shouldMarkReleaseLatest("v8.1.0", AS_IT_STOOD)).toBe(false);
  });

  test("a genuinely newest release still TAKES the badge", () => {
    // The rule must not be "never latest" — that would be a gate that passes by
    // refusing to do the thing it guards.
    expect(shouldMarkReleaseLatest("v10.0.5", AS_IT_STOOD)).toBe(true);
    expect(shouldMarkReleaseLatest("v10.1.0", AS_IT_STOOD)).toBe(true);
    expect(shouldMarkReleaseLatest("v11.0.0", AS_IT_STOOD)).toBe(true);
  });

  test("comparison is numeric, not lexicographic", () => {
    // `sort` on text puts v9.1.2 above v10.0.4, which would deny the badge to
    // every v10 release for as long as any v9 one exists.
    expect(shouldMarkReleaseLatest("v10.0.0", [{ tagName: "v9.1.2" }])).toBe(
      true
    );
    expect(shouldMarkReleaseLatest("v9.1.2", [{ tagName: "v10.0.0" }])).toBe(
      false
    );
  });

  test("the first release of all takes the badge", () => {
    expect(shouldMarkReleaseLatest("v1.0.0", [])).toBe(true);
  });

  test("re-publishing the SAME version keeps the badge", () => {
    // Equal is not "higher", so a re-run of the newest release is still latest.
    expect(shouldMarkReleaseLatest("v10.0.4", AS_IT_STOOD)).toBe(true);
  });

  test("drafts and pre-releases are ignored", () => {
    // GitHub never puts the badge on either, so counting them would let a stale
    // pre-release deny it to a legitimate stable release.
    expect(
      shouldMarkReleaseLatest("v6.0.0", [
        { tagName: "v9.9.9", isPrerelease: true },
        { tagName: "v9.9.8", isDraft: true }
      ])
    ).toBe(true);
  });

  test("tags that are not vX.Y.Z are ignored on BOTH sides", () => {
    // This repo carries prefix-less legacy tags (`3.0.0`, `4.5.0`). Comparing
    // something that is not a release version yields a meaningless ordering.
    expect(shouldMarkReleaseLatest("v1.0.0", [{ tagName: "3.0.0" }])).toBe(
      true
    );
    expect(shouldMarkReleaseLatest("nightly", AS_IT_STOOD)).toBe(false);
  });
});

describe("the CLI bridge fails CLOSED", () => {
  test("real `gh release list` output decides correctly", () => {
    const json = JSON.stringify([
      { tagName: "v10.0.4", isPrerelease: false, isDraft: false },
      { tagName: "v10.0.2", isPrerelease: false, isDraft: false }
    ]);
    expect(decideFromRawInput("v10.0.0", json)).toBe(false);
    expect(decideFromRawInput("v10.0.5", json)).toBe(true);
  });

  test("unreadable input prints false, never true", () => {
    // Asymmetric on purpose: a wrong `false` leaves a release without a badge,
    // which is visible and one `gh release edit` away. A wrong `true` moves the
    // badge to the wrong version and nothing reports it.
    expect(decideFromRawInput("v10.0.5", "not json")).toBe(false);
    expect(decideFromRawInput("v10.0.5", "")).toBe(false);
    expect(decideFromRawInput("v10.0.5", '{"not":"an array"}')).toBe(false);
    expect(decideFromRawInput("", "[]")).toBe(false);
  });

  test("malformed entries are skipped, not crashed on", () => {
    const json = JSON.stringify([
      null,
      "v10.0.4",
      { noTagName: true },
      { tagName: "v10.0.4" }
    ]);
    expect(decideFromRawInput("v10.0.5", json)).toBe(true);
    expect(decideFromRawInput("v10.0.0", json)).toBe(false);
  });
});

/**
 * The workflow half. `shouldMarkReleaseLatest` being right is worth nothing if
 * `release.yml` stops asking it — and the defect this ADR repairs was a missing
 * flag, i.e. exactly a workflow-shaped hole that no source gate could read.
 */
describe("release.yml actually uses the decision", () => {
  const workflow = readFileSync(
    path.join(import.meta.dir, "..", ".github/workflows/release.yml"),
    "utf8"
  );

  /**
   * Every `gh release create` INVOCATION, reassembled from its continuation
   * lines. Comment lines are excluded, and that exclusion is the point: this
   * workflow discusses `gh release create` in prose twice, so a plain substring
   * search finds a comment first and answers a question about documentation
   * while appearing to answer one about behaviour.
   */
  function releaseCreateCommands(): string[] {
    const lines = workflow.split("\n");
    const commands: string[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      if (!/^\s*gh release create\b/.test(lines[i]!)) continue;

      let command = lines[i]!;
      while (command.trimEnd().endsWith("\\") && i + 1 < lines.length) {
        i += 1;
        command += `\n${lines[i]!}`;
      }
      commands.push(command);
    }

    return commands;
  }

  test("`gh release create` passes an EXPLICIT --latest", () => {
    // The whole defect was the absence of this flag. Asserting EVERY real
    // invocation carries one is the single assertion that would have caught it.
    const commands = releaseCreateCommands();
    expect(commands.length).toBeGreaterThan(0);

    for (const command of commands) {
      expect(command).toContain("--latest=");
      expect(command).toContain("steps.latest_flag.outputs.value");
    }
  });

  test("the flag comes from the tested script, not from inline shell", () => {
    // Version comparison inside a `run:` block is logic no test can reach, and
    // untested logic in a release path is how this got here.
    expect(workflow).toContain("bun scripts/release-latest-flag.ts");
    expect(workflow).toContain("gh release list --limit 200");
  });

  test("the badge is re-read after publishing", () => {
    // ADR-0117's amendment: the mechanism chosen to guarantee a property broke
    // it on first run, and only a re-read nobody thought necessary caught it.
    expect(workflow).toContain("releases/latest");
    expect(workflow).toContain("Verify the badge landed where it was decided");
  });

  test("`sign-attest-publish` installs Bun before invoking it", () => {
    // `sign-attest-publish` runs in its own isolated job (`needs: build`), so
    // the `Setup Bun` step from `validate` does not carry over — the decision
    // step's `bun scripts/release-latest-flag.ts` needs its own install.
    const jobStart = workflow.indexOf("sign-attest-publish:");
    expect(jobStart).toBeGreaterThan(-1);

    const bunInvocation = workflow.indexOf(
      "bun scripts/release-latest-flag.ts",
      jobStart
    );
    expect(bunInvocation).toBeGreaterThan(jobStart);

    const setupBun = workflow.indexOf("oven-sh/setup-bun@", jobStart);
    expect(setupBun).toBeGreaterThan(jobStart);
    expect(setupBun).toBeLessThan(bunInvocation);
  });
});
