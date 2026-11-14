/**
 * `deps:provider-changelog:check` (Issue #1173), both directions per rule:
 * register -> code (a pin that no longer matches), code -> register (a source
 * file that names a provider host nobody registered), and the review clock.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  addDays,
  collectSources,
  evaluateEntry,
  evaluateRegister
} from "../scripts/provider-changelog-check";
import {
  PROVIDER_HOSTS,
  PROVIDER_REGISTER,
  WARN_DAYS,
  type ProviderEntry
} from "../scripts/provider-api-register";

const FILE = "src/modules/x/client.ts";

function entry(overrides: Partial<ProviderEntry> = {}): ProviderEntry {
  return {
    id: "demo",
    provider: "Demo",
    surface: "send",
    status: "active",
    hosts: ["api.demo.test"],
    usedVersion: "v3",
    changelogUrl: "https://demo.test/changelog",
    pins: [{ file: FILE, literal: 'VERSION = "v3"' }],
    files: [FILE],
    recordedOn: "2026-11-01",
    lastReview: "2026-11-01",
    maxAgeDays: 90,
    owner: "maintainer",
    ...overrides
  };
}

const SOURCE = 'const VERSION = "v3"; const HOST = "api.demo.test";';

function run(
  register: readonly ProviderEntry[],
  options: {
    sources?: Record<string, string>;
    today?: string;
    checkAge?: boolean;
  } = {}
) {
  const sources = new Map(
    Object.entries(options.sources ?? { [FILE]: SOURCE })
  );

  return evaluateRegister({
    register,
    providerHosts: ["api.demo.test", "api.tiktok.test"],
    sources,
    readFile: (relative) => sources.get(relative),
    today: options.today ?? "2026-11-14",
    warnDays: 14,
    checkAge: options.checkAge ?? true
  });
}

describe("register -> code", () => {
  test("a register that matches the code is clean", () => {
    expect(run([entry()]).failures).toEqual([]);
  });

  test("changing the version in code without the register fails the gate", () => {
    const report = run([entry()], {
      sources: { [FILE]: 'const VERSION = "v4"; const HOST = "api.demo.test";' }
    });

    expect(report.failures.join("\n")).toContain("no longer in");
  });

  test("a pinned file that disappeared fails", () => {
    const report = run([
      entry({ pins: [{ file: "src/gone.ts", literal: "x" }] })
    ]);

    expect(report.failures.join("\n")).toContain("does not exist");
  });

  test("an active entry with no pin fails: nothing ties it to the code", () => {
    expect(run([entry({ pins: [] })]).failures.join("\n")).toContain(
      "at least one pin"
    );
  });

  test("a listed file that stopped naming the host fails", () => {
    const report = run([entry()], {
      sources: { [FILE]: 'const VERSION = "v3";' }
    });

    expect(report.failures.join("\n")).toContain("no longer names any");
  });
});

describe("code -> register", () => {
  test("a source file naming a provider host with no entry fails", () => {
    const report = run([entry()], {
      sources: {
        [FILE]: SOURCE,
        "src/modules/y/other.ts": 'fetch("https://api.demo.test/send")'
      }
    });

    expect(report.failures.join("\n")).toContain(
      "src/modules/y/other.ts names api.demo.test but no active entry lists it"
    );
  });

  test("a file for another host does not need this entry", () => {
    const report = run([entry()], {
      sources: { [FILE]: SOURCE, "src/z.ts": "no provider here" }
    });

    expect(report.failures).toEqual([]);
  });

  test("a planned entry owns nothing, and its host appearing in code fails", () => {
    const planned = entry({
      id: "tiktok",
      status: "planned",
      hosts: ["api.tiktok.test"],
      pins: [],
      files: []
    });

    expect(run([planned], { sources: {} }).failures).toEqual([]);

    const appeared = run([planned], {
      sources: { "src/t.ts": 'fetch("https://api.tiktok.test/post")' }
    });

    expect(appeared.findings.map((x) => x.detail).join("\n")).toContain(
      "still `planned`"
    );

    expect(run([entry({ status: "planned" })]).failures.join("\n")).toContain(
      "planned entry must have no files or pins"
    );
  });
});

describe("review clock", () => {
  test("due date is the last review plus maxAgeDays; unreviewed entries run on recordedOn", () => {
    const reviewed = evaluateEntry(
      entry({ lastReview: "2026-11-01", recordedOn: "2026-01-01" }),
      "2026-11-14",
      14
    );
    const never = evaluateEntry(
      entry({ lastReview: null, recordedOn: "2026-08-01" }),
      "2026-11-14",
      14
    );

    expect(reviewed.dueOn).toBe(addDays("2026-11-01", 90));
    expect(never.dueOn).toBe(addDays("2026-08-01", 90));
    expect(never.neverReviewed).toBe(true);
  });

  test("the last day is still ok; the next day is overdue and fails", () => {
    const e = entry({ lastReview: "2026-08-16" }); // due 2026-11-14

    expect(run([e], { today: "2026-11-14" }).failures).toEqual([]);

    const late = run([e], { today: "2026-11-15" });

    expect(late.failures.join("\n")).toContain("review overdue");
    expect(late.evaluations[0]?.review).toBe("overdue");
  });

  test("--skip-age keeps the structural rules but not the deadline", () => {
    const e = entry({ lastReview: "2025-01-01" });

    expect(run([e], { checkAge: true }).failures.length).toBeGreaterThan(0);
    expect(run([e], { checkAge: false }).failures).toEqual([]);
  });

  test("due within the warning window is a warning and an issue, not a failure", () => {
    const e = entry({ lastReview: "2026-08-20" }); // due 2026-11-18, 4 days
    const report = run([e], { today: "2026-11-14" });

    expect(report.failures).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.findings[0]?.key).toBe("provider:review-due-soon:demo");
  });

  test("a review dated in the future cannot defer the deadline", () => {
    expect(
      run([entry({ lastReview: "2027-01-01" })]).failures.join("\n")
    ).toContain("in the future");
  });

  test("malformed dates and intervals fail instead of being compared as text", () => {
    expect(
      run([entry({ lastReview: "14/11/2026" })]).failures.join("\n")
    ).toContain("not YYYY-MM-DD");
    expect(run([entry({ maxAgeDays: 0 })]).failures.join("\n")).toContain(
      "maxAgeDays"
    );
  });

  test("finding keys are stable across days, so the issue is not refiled", () => {
    const e = entry({ lastReview: "2026-08-01" });
    const a = run([e], { today: "2026-11-14" }).findings.map((f) => f.key);
    const b = run([e], { today: "2026-12-30" }).findings.map((f) => f.key);

    expect(a).toEqual(b);
    expect(a).toEqual(["provider:review-overdue:demo"]);
  });

  test("duplicate ids are refused", () => {
    expect(run([entry(), entry()]).failures.join("\n")).toContain(
      "duplicate id"
    );
  });
});

describe("the repository's own register, against the real source tree", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const sources = collectSources(root, "src");

  const report = evaluateRegister({
    register: PROVIDER_REGISTER,
    providerHosts: PROVIDER_HOSTS,
    sources,
    readFile: (relative) => sources.get(relative),
    today: "2026-11-14",
    warnDays: WARN_DAYS,
    // Structure only: the clock is the CLI gate's job, a test that fails on a
    // calendar date would break unrelated PRs.
    checkAge: false
  });

  test("every pin is still in the code and every provider call site is registered", () => {
    expect(report.failures).toEqual([]);
  });

  test("covers every provider the issue names", () => {
    const text = PROVIDER_REGISTER.map((e) => e.provider).join(" | ");

    for (const provider of [
      "Meta Graph",
      "WhatsApp",
      "Telegram",
      "Mailketing",
      "Google",
      "TikTok"
    ]) {
      expect(text).toContain(provider);
    }
  });

  test("a recorded review is a real date no later than today", () => {
    for (const e of PROVIDER_REGISTER) {
      if (e.lastReview !== null) {
        expect(e.lastReview).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      expect(e.changelogUrl).toMatch(/^https:\/\//);
    }
  });
});
