/**
 * `deps:freshness` (Issue #1173): the parsers, the drift classification, the
 * UNKNOWN-is-not-a-pass rule and the strict verdict — all pure, no registry.
 *
 * The `bun outdated` samples are copied from real Bun 1.4.4 output taken on
 * 2026-10-24.
 */
import { describe, expect, test } from "bun:test";

import {
  buildManifest,
  classifyDrift,
  classifyTagDrift,
  compareVersions,
  evaluateHeldBack,
  parseCrontabImages,
  parseDockerfileImages,
  parseOutdatedOutput,
  parseRecordedDigests,
  pickNewestTag,
  renderMarkdown,
  type ImageReport,
  type Section
} from "../scripts/dependency-freshness";
import type { HeldBackEntry } from "../scripts/dependency-held-back";

const REAL_OUTDATED = `bun outdated v1.4.4 (38afee6c8)
|---------------------------------------------------------|
| Package                     | Current | Update | Latest |
|-----------------------------|---------|--------|--------|
| @astrojs/node               | 11.1.7  | 11.1.9 | 11.1.9 |
|-----------------------------|---------|--------|--------|
| astro                       | 7.4.0   | 7.4.2  | 7.4.2  |
|-----------------------------|---------|--------|--------|
| prettier-plugin-astro (dev) | 1.1.1   | 1.1.2  | 1.1.2  |
|---------------------------------------------------------|
`;

describe("versions", () => {
  test("compareVersions orders releases and prereleases", () => {
    expect(compareVersions("1.4.3", "1.4.4")).toBe(-1);
    expect(compareVersions("1.4.4", "1.4.4")).toBe(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareVersions("latest", "1.0.0")).toBeNull();
  });

  test("classifyDrift names the largest differing component", () => {
    expect(classifyDrift("7.4.0", "7.4.2")).toBe("patch");
    expect(classifyDrift("7.4.0", "7.5.0")).toBe("minor");
    expect(classifyDrift("7.4.0", "8.0.0")).toBe("major");
    expect(classifyDrift("1.4.4", "1.4.4")).toBe("current");
    // A pinned canary ahead of the registry's latest is not drift.
    expect(classifyDrift("1.5.0", "1.4.4")).toBe("current");
    expect(classifyDrift("workspace:*", "1.0.0")).toBe("unknown");
  });
});

describe("parseOutdatedOutput", () => {
  test("parses the real table, including the (dev) marker", () => {
    const rows = parseOutdatedOutput(REAL_OUTDATED);

    expect(rows.map((r) => r.name)).toEqual([
      "@astrojs/node",
      "astro",
      "prettier-plugin-astro"
    ]);
    expect(rows[2]?.kind).toBe("dev");
    expect(rows[1]).toMatchObject({
      current: "7.4.0",
      update: "7.4.2",
      latest: "7.4.2",
      drift: "patch",
      inRange: true
    });
  });

  test("a held-out major shows as not in range", () => {
    const rows = parseOutdatedOutput(
      [
        "bun outdated v1.4.4 (x)",
        "|------|",
        "| Package | Current | Update | Latest |",
        "|---|---|---|---|",
        "| typescript | 7.0.2 | 7.0.2 | 8.0.0 |"
      ].join("\n")
    );

    expect(rows[0]).toMatchObject({ drift: "major", inRange: false });
  });

  test("only the banner means nothing is outdated", () => {
    expect(parseOutdatedOutput("bun outdated v1.4.4 (38afee6c8)\n")).toEqual(
      []
    );
  });

  test("anything that is not a table or the banner throws instead of reading as 'all current'", () => {
    expect(() =>
      parseOutdatedOutput(
        "bun outdated v1.4.4\nerror: ConnectionRefused downloading package manifest astro\n"
      )
    ).toThrow(/unexpected output/);
    expect(() =>
      parseOutdatedOutput("bun outdated v1.4.4\n| Name | Version |\n")
    ).toThrow();
    expect(() => parseOutdatedOutput("| a | b | c | d |\n")).toThrow();
  });
});

describe("pinned images", () => {
  test("Dockerfile: registry images only, not build stages", () => {
    const refs = parseDockerfileImages(
      [
        "FROM oven/bun:1.4.4 AS base",
        "FROM base AS deps",
        "FROM base AS build",
        "FROM scratch",
        "FROM node:22-alpine AS other"
      ].join("\n")
    );

    expect(refs.map((r) => r.ref)).toEqual([
      "oven/bun:1.4.4",
      "node:22-alpine"
    ]);
    expect(refs[0]).toMatchObject({ image: "oven/bun", tag: "1.4.4" });
  });

  test("crontab: the image argument of docker run, not mounts, networks or comments", () => {
    const refs = parseCrontabImages(
      [
        "# docker run --rm oven/bun:9.9.9 is a comment",
        "AWCMS_RUN=docker run --rm --network container:eel59mczdlkidkm5a6fhbdeh -v /opt/awcms:/app -w /app --env-file /etc/awcms/worker.env oven/bun:1.4.4-alpine bun run",
        "AWCMS_PGRUN=docker run --rm --network container:eel59mczdlkidkm5a6fhbdeh -v /var/backups/awcms:/backup --env-file /etc/awcms/backup.env postgres:18.4 bash"
      ].join("\n")
    );

    expect(refs.map((r) => r.ref)).toEqual([
      "oven/bun:1.4.4-alpine",
      "postgres:18.4"
    ]);
  });

  test("the repo's real Dockerfile and crontab still yield images (the parsers have not gone blind)", async () => {
    const dockerfile = await Bun.file("Dockerfile.production").text();
    const crontab = await Bun.file("deploy/cron/awcms.crontab").text();

    expect(parseDockerfileImages(dockerfile).length).toBeGreaterThan(0);
    expect(parseCrontabImages(crontab).length).toBeGreaterThan(0);
    expect(parseRecordedDigests(dockerfile).length).toBeGreaterThan(0);
  });

  test("recorded digests are read from hex prefixes of 12+ chars", () => {
    expect(
      parseRecordedDigests("index digest sha256:1d22548f177f... and sha256:abc")
    ).toEqual(["1d22548f177f"]);
  });

  test("pickNewestTag compares only tags of the same shape", () => {
    const tags = [
      "latest",
      "1.4.4",
      "1.4.5",
      "1.4.5-alpine",
      "1.4.4-alpine",
      "1",
      "1.4",
      "canary"
    ];

    expect(pickNewestTag(tags, "1.4.4")).toBe("1.4.5");
    expect(pickNewestTag(tags, "1.4.4-alpine")).toBe("1.4.5-alpine");
    expect(pickNewestTag(["18.4", "18.6", "17.9", "19"], "18.4")).toBe("19");
    expect(pickNewestTag(["latest"], "1.4.4")).toBeNull();
    expect(pickNewestTag(tags, "latest")).toBeNull();
  });

  test("classifyTagDrift", () => {
    expect(classifyTagDrift("18.4", "18.6")).toBe("minor");
    expect(classifyTagDrift("18.4", "19")).toBe("major");
    expect(classifyTagDrift("1.4.4-alpine", "1.4.5-alpine")).toBe("patch");
    expect(classifyTagDrift("1.4.4", "1.4.4")).toBe("current");
  });
});

const ENTRY: HeldBackEntry = {
  packageName: "left-pad",
  heldVersion: "1.3.0",
  reason: "2.0 drops CommonJS",
  owner: "someone",
  reviewDate: "2027-01-01"
};

describe("evaluateHeldBack", () => {
  const latest = (value: string | "current" | undefined) => () => value;

  test("an entry that is behind and in date is active", () => {
    expect(
      evaluateHeldBack([ENTRY], "2026-10-24", latest("2.0.0"))[0]?.status
    ).toBe("active");
  });

  test("past its review date it is expired, whatever the registry says", () => {
    expect(
      evaluateHeldBack([ENTRY], "2027-01-02", latest("2.0.0"))[0]?.status
    ).toBe("expired");
    expect(
      evaluateHeldBack([ENTRY], "2027-01-02", latest(undefined))[0]?.status
    ).toBe("expired");
  });

  test("a hold that is no longer behind is stale", () => {
    expect(
      evaluateHeldBack([ENTRY], "2026-10-24", latest("1.3.0"))[0]?.status
    ).toBe("stale");
    expect(
      evaluateHeldBack([ENTRY], "2026-10-24", latest("current"))[0]?.status
    ).toBe("stale");
  });

  test("an unreachable registry is unverified, never active", () => {
    expect(
      evaluateHeldBack([ENTRY], "2026-10-24", latest(undefined))[0]?.status
    ).toBe("unverified");
  });
});

describe("buildManifest: UNKNOWN is not a pass", () => {
  const ok = <T>(data: T): Section<T> => ({ status: "ok", data });
  const down: Section<never> = { status: "unknown", reason: "registry down" };

  const cleanImage: ImageReport = {
    file: "Dockerfile.production",
    ref: "oven/bun:1.4.4",
    image: "oven/bun",
    tag: "1.4.4",
    result: ok({
      digest: "sha256:aaaa",
      lastUpdated: null,
      digestRecorded: "match",
      newestTag: "1.4.4",
      drift: "current"
    })
  };

  const base = {
    generatedAt: "2026-10-24T00:00:00.000Z",
    bunVersionUsed: "1.4.4",
    outdated: ok({ directDependencyCount: 10, rows: [] }),
    advisories: ok({
      blocking: [],
      informationalCount: 0,
      exceptionCount: 0,
      bySeverity: {}
    }),
    bun: ok({ pinned: "1.4.4", latest: "1.4.4", drift: "current" as const }),
    images: [cleanImage]
  };

  test("everything ran and nothing blocks: no strict failures", () => {
    const manifest = buildManifest(base);

    expect(manifest.strictFailures).toEqual([]);
    expect(manifest.unknownSections).toEqual([]);
    expect(manifest.mode).toBe("read-only");
  });

  test("drift alone does not fail the verdict", () => {
    const manifest = buildManifest({
      ...base,
      outdated: ok({
        directDependencyCount: 10,
        rows: parseOutdatedOutput(REAL_OUTDATED)
      })
    });

    expect(manifest.strictFailures).toEqual([]);
  });

  test("each failed section is UNKNOWN and a strict failure", () => {
    const manifest = buildManifest({
      ...base,
      outdated: down,
      advisories: down,
      bun: down,
      images: [{ ...cleanImage, result: down }]
    });

    expect(manifest.unknownSections).toEqual([
      "bun outdated",
      "bun audit",
      "Bun pin vs npm",
      "image oven/bun:1.4.4 (Dockerfile.production)"
    ]);
    expect(manifest.strictFailures).toHaveLength(4);

    const markdown = renderMarkdown(manifest);

    expect(markdown).toContain("**UNKNOWN**");
    expect(markdown).not.toContain("0 of");
    expect(markdown).not.toContain("No advisories at all");
  });

  test("a blocking advisory and an image digest mismatch are strict failures", () => {
    const manifest = buildManifest({
      ...base,
      advisories: ok({
        blocking: ["nanoid: [high] x"],
        informationalCount: 0,
        exceptionCount: 0,
        bySeverity: { high: 1 }
      }),
      images: [
        {
          ...cleanImage,
          result: ok({
            digest: "sha256:bbbb",
            lastUpdated: null,
            digestRecorded: "mismatch" as const,
            newestTag: "1.4.4",
            drift: "current" as const
          })
        }
      ]
    });

    expect(manifest.strictFailures.join("\n")).toContain("advisory: nanoid");
    expect(manifest.strictFailures.join("\n")).toContain("no longer matches");
  });

  test("the held-back bun entry is judged against npm's latest, and unverified when npm is down", () => {
    const withBun = buildManifest(base);

    expect(
      withBun.heldBack.find((e) => e.entry.packageName === "bun")?.latest
    ).toBe("1.4.4");

    const withoutBun = buildManifest({ ...base, bun: down });

    expect(
      withoutBun.heldBack.find((e) => e.entry.packageName === "bun")?.status
    ).toBe("unverified");
  });
});
