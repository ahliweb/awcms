/**
 * The documented list of mandatory env vars must equal the enforced one.
 *
 * ## What this caught
 *
 * `deployment-profiles.md` listed five required variables: `APP_ENV`,
 * `APP_URL`, `APP_TIMEZONE`, `DATABASE_URL`, `AUTH_JWT_SECRET`. Only three of
 * those are enforced, and **two of them do not exist** — no code in `src/` or
 * `scripts/` reads `APP_TIMEZONE` or `AUTH_JWT_SECRET`. The list was copied
 * from a 2026-07-14 sprint plan and never reconciled with what shipped.
 *
 * That is worse than untidy. `AUTH_JWT_SECRET` had propagated into
 * `deploy-coolify.md`'s required table, the deploy skill, and (recently) the
 * owner-account section of `.env.example`, where it carried a security claim:
 * that three environments are isolated partly because each has its own JWT
 * secret. There is no JWT anywhere in the session path — tokens are opaque
 * random values stored as sha256 hashes in the tenant-scoped `awcms_sessions`.
 * An operator acting on the old text would set a variable that does nothing
 * and believe they had bought isolation they had not.
 *
 * ## Why a test
 *
 * The two halves live in different languages and move independently: a prose
 * bullet edited by hand, and a `RULES` array in TypeScript. Nothing compared
 * them, so the doc drifted in the dangerous direction — over-claiming while
 * the validator quietly enforced less. Parsing the doc bullet and the source
 * array and asserting set equality is the only thing that notices.
 *
 * Deliberately parses `validate-env.ts` as text rather than importing it: the
 * rule list is a module-private const, and importing to read it would either
 * force an export that exists only for tests or execute validation at import
 * time. No database, no network — runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const VALIDATOR = "scripts/validate-env.ts";
const DOC = "docs/awcms/deployment-profiles.md";

/** `- Wajib non-kosong: \`A\`, \`B\`, \`C\`.` — the bullet operators read. */
const DOC_BULLET = /^- Must be non-empty:([^.]*)\./m;

function repoFile(relative: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relative), "utf8");
}

/**
 * Every `{ name: "X", ... required: true }` in the `RULES` array. Matches the
 * name and then looks ahead only as far as the next `name:` key, so a
 * `required: true` belonging to a later rule can never be attributed to an
 * earlier one — the bug a naive `[\s\S]*?` window would introduce.
 */
function enforcedRequired(source: string): Set<string> {
  const required = new Set<string>();
  const rules = [...source.matchAll(/name:\s*"([A-Z][A-Z0-9_]*)"/g)];

  for (const [index, rule] of rules.entries()) {
    const start = rule.index! + rule[0].length;
    const end = rules[index + 1]?.index ?? source.length;

    if (/required:\s*true/.test(source.slice(start, end))) {
      required.add(rule[1]!);
    }
  }

  return required;
}

function documentedRequired(doc: string): Set<string> {
  const bullet = doc.match(DOC_BULLET);

  if (!bullet?.[1]) {
    throw new Error(
      `${DOC} no longer contains a "- Wajib non-kosong: ..." bullet. If the ` +
        `section moved, update DOC_BULLET here — do not delete this test.`
    );
  }

  return new Set(
    [...bullet[1].matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((match) => match[1]!)
  );
}

describe("documented mandatory env vars match the validator", () => {
  test("the doc bullet and validate-env agree exactly", async () => {
    const [source, doc] = await Promise.all([
      repoFile(VALIDATOR),
      repoFile(DOC)
    ]);

    const enforced = enforcedRequired(source);
    const documented = documentedRequired(doc);

    // Guard the parsers themselves: an empty set on either side would make the
    // comparison vacuously pass if a regex silently stopped matching.
    expect(enforced.size).toBeGreaterThan(0);
    expect(documented.size).toBeGreaterThan(0);

    expect([...documented].sort()).toEqual([...enforced].sort());
  });

  test("no doc or skill still presents AUTH_JWT_SECRET as a live variable", async () => {
    // The variable does not exist. Two files may still name it: this test, and
    // the correction notes that explain its absence — both of which say so.
    const files = [
      ".env.example",
      "docs/awcms/environments.md",
      "docs/awcms/deployment-profiles.md",
      "docs/awcms/deploy-coolify.md",
      ".claude/skills/awcms-deploy/SKILL.md"
    ];

    const offenders: string[] = [];

    for (const file of files) {
      const body = await repoFile(file);

      for (const [index, line] of body.split("\n").entries()) {
        if (!line.includes("AUTH_JWT_SECRET")) {
          continue;
        }

        // A mention is fine only when the same line says it does not exist.
        if (
          /tidak ada|tidak dibaca|does not exist|pernah tercantum|neither exists|no code reads|used to be listed|have been removed/.test(
            line
          )
        ) {
          continue;
        }

        offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("neither phantom variable is read by any code", async () => {
    // The claim the two tests above rest on. If someone later introduces a
    // real AUTH_JWT_SECRET, this fails and the correction notes must be
    // rewritten rather than left standing as false denials.
    //
    // Matches READ SYNTAX, not the bare name. The first draft matched the name
    // and immediately failed on `src/lib/security/client-fingerprint.ts`,
    // whose comment explains that mini keys an HMAC with `AUTH_JWT_SECRET` and
    // that this base "has no such variable at all" — a true statement the gate
    // would have forced someone to delete. Comments are not stripped first:
    // over-stripping (a `//` inside a URL) can hide a real read, whereas the
    // only cost of not stripping is a comment that spells out a full
    // `process.env.X` expression, which fails loudly and is trivially reworded.
    const glob = new Bun.Glob("{src,scripts}/**/*.ts");
    const phantom = ["AUTH_JWT_SECRET", "APP_TIMEZONE"];
    const offenders: string[] = [];

    for await (const file of glob.scan(process.cwd())) {
      const body = await repoFile(file);

      for (const name of phantom) {
        const read = new RegExp(
          `(process|Bun|import\\.meta)\\.env(\\.${name}\\b|\\[\\s*["'\`]${name}["'\`]\\s*\\])`
        );

        if (read.test(body)) {
          offenders.push(`${file} reads ${name} from the environment`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
