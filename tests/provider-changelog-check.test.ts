/**
 * `deps:provider-changelog:check` (Issue #1173), both directions per rule:
 * register -> code (a pin that no longer matches), code -> register (a source
 * file that names a provider host nobody registered), and the review clock.
 */
import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  addDays,
  collectSources,
  evaluateEntry,
  evaluateRegister,
  MAX_AGE_DAYS_CEILING
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

    expect(report.failures.join("\n")).toContain("must appear exactly once");
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

/**
 * The code -> register rule only sees hosts that are ALREADY in
 * `PROVIDER_HOSTS`, so a provider nobody listed is invisible to it. This test
 * closes that: every host named by an `https://` literal in non-test source is
 * either a provider host or appears below with the reason it is not one.
 * Adding a new outbound integration without choosing fails here.
 */
const NOT_A_PROVIDER: Record<string, readonly string[]> = {
  "XML/JSON namespaces and spec links, never fetched": [
    "www.w3.org",
    "www.sitemaps.org",
    "www.google.com",
    "jsonfeed.org",
    "schema.org",
    "prometheus.io",
    "webkit.org"
  ],
  "outbound links built for the reader's browser (share, deep link, profile URL), no server call":
    [
      "t.me",
      "wa.me",
      "twitter.com",
      "www.facebook.com",
      "www.linkedin.com",
      "github.com"
    ],
  "embed allow-list or output rewriting, the browser fetches it": [
    "www.youtube-nocookie.com"
  ],
  "Web Push endpoint recognised in a subscription the browser supplies (RFC 8030), not an API this code is a client of":
    ["updates.push.services.mozilla.com"],
  "documentation reference in a comment": ["docs.starsender.online"],
  "illustrative host in a comment, a test double or a doc example": [
    "a.co",
    "abc123.r2.cloudflarestorage.com",
    "app.example.com.evil.test",
    "awcms.ahlikoding.com",
    "cms.example",
    "evil.com",
    "evil.test",
    "internal.invalid",
    "media.example.com",
    "media.example.test",
    "media.example.test.evil.com",
    "news.example",
    "placeholder.invalid",
    "push-target-path.invalid",
    "redirect-normalize.invalid",
    "seo-distribution.invalid",
    "tenant.example",
    "www.seputarborneo.com"
  ]
};

describe("every outbound host in source is a provider or consciously not one", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const sources = collectSources(root, "src");
  const found = new Set<string>();

  for (const text of sources.values()) {
    for (const match of text.matchAll(
      /https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi
    )) {
      found.add((match[1] as string).toLowerCase());
    }
  }

  const known = new Set<string>([
    ...PROVIDER_HOSTS,
    ...Object.values(NOT_A_PROVIDER).flat()
  ]);

  test("no host is unaccounted for", () => {
    expect([...found].filter((host) => !known.has(host)).sort()).toEqual([]);
  });

  test("the allow-list has no entry the source no longer names", () => {
    expect(
      Object.values(NOT_A_PROVIDER)
        .flat()
        .filter((host) => !found.has(host))
    ).toEqual([]);
  });

  test("the five providers the first pass missed are registered", () => {
    for (const host of [
      "api.fonnte.com",
      "api.starsender.online",
      "api.cloudflare.com",
      "challenges.cloudflare.com",
      "api.github.com"
    ]) {
      expect(PROVIDER_HOSTS).toContain(host);
      expect(
        PROVIDER_REGISTER.some(
          (e) => e.status === "active" && e.hosts.includes(host)
        )
      ).toBe(true);
    }
  });
});

describe("the review clock cannot be deferred through its other levers", () => {
  const base = { today: "2026-11-14", warnDays: WARN_DAYS, checkAge: true };

  function run(e: ProviderEntry) {
    return evaluateRegister({
      ...base,
      register: [e],
      providerHosts: ["api.demo.test"],
      sources: new Map([[FILE, 'const VERSION = "v3"; // api.demo.test']]),
      readFile: () => 'const VERSION = "v3"; // api.demo.test'
    });
  }

  test("a recordedOn in the future fails", () => {
    const report = run(entry({ recordedOn: "2099-01-01", lastReview: null }));

    expect(report.failures.join("\n")).toContain("recordedOn");
  });

  test("an interval above the ceiling fails and a huge or infinite one cannot crash the run", () => {
    for (const maxAgeDays of [
      MAX_AGE_DAYS_CEILING + 1,
      1e6,
      1e12,
      Number.POSITIVE_INFINITY,
      Number.NaN
    ]) {
      const report = run(entry({ maxAgeDays }));

      expect(report.failures.join("\n")).toContain("maxAgeDays");
    }

    expect(run(entry({ maxAgeDays: MAX_AGE_DAYS_CEILING })).failures).toEqual(
      []
    );
  });
});

describe("pins must identify one place", () => {
  const withText = (text: string) =>
    evaluateRegister({
      register: [entry()],
      providerHosts: ["api.demo.test"],
      sources: new Map([[FILE, `${text} // api.demo.test`]]),
      readFile: () => text,
      today: "2026-11-14",
      warnDays: WARN_DAYS,
      checkAge: false
    }).failures;

  test("a literal that appears twice does not pass, bumping one copy would go unnoticed", () => {
    expect(withText('VERSION = "v3"; OTHER = VERSION = "v3"')).toHaveLength(1);
  });

  test("a literal that appears once passes and one that is gone fails", () => {
    expect(withText('VERSION = "v3"')).toEqual([]);
    expect(withText("nothing")).toHaveLength(1);
  });
});

describe("a listed file that does not exist fails", () => {
  test("file-missing is reported, not skipped", () => {
    const report = evaluateRegister({
      register: [entry({ files: [FILE, "src/modules/x/gone.ts"] })],
      providerHosts: ["api.demo.test"],
      sources: new Map([[FILE, 'VERSION = "v3" api.demo.test']]),
      readFile: (relative) =>
        relative === FILE ? 'VERSION = "v3" api.demo.test' : undefined,
      today: "2026-11-14",
      warnDays: WARN_DAYS,
      checkAge: false
    });

    expect(report.failures.join("\n")).toContain("gone.ts");
  });
});

describe("collectSources", () => {
  test("never follows a symlink out of the root", () => {
    const base = mkdtempSync(path.join(tmpdir(), "collect-sources-"));

    try {
      const root = path.join(base, "root");
      const outside = path.join(base, "outside");

      mkdirSync(path.join(root, "src"), { recursive: true });
      mkdirSync(outside);
      writeFileSync(path.join(root, "src", "a.ts"), "api.demo.test");
      writeFileSync(path.join(outside, "secret.ts"), "api.demo.test");
      symlinkSync(outside, path.join(root, "src", "link"));
      symlinkSync(
        path.join(outside, "secret.ts"),
        path.join(root, "src", "b.ts")
      );

      expect([...collectSources(root, "src").keys()]).toEqual(["src/a.ts"]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
