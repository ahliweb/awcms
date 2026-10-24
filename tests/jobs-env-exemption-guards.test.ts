/**
 * The three hand-written exemption lists behind per-job secret scoping are each
 * held to the code by a check (Issue #1131, L4). A check that has never been seen
 * to fail proves nothing, so this file feeds each one a synthetic violation and
 * asserts it fires, and runs `ops/run-job.sh` for real against a stub `docker`
 * to prove the operator-only refusal happens before the runner touches it.
 *
 * - `REACHES_WITHOUT_READING`: the reader file itself used to be skipped, so a
 *   helper in it calling a reader internally went unnoticed.
 * - `UNTRACEABLE_IMPORT_SITES`: keyed by file only, a second computed import in a
 *   listed file was accepted silently.
 * - `OPERATOR_ONLY_TARGETS`: proved to need a web-only variable, yet nothing
 *   stopped `ops/run-job.sh security:readiness` running in a job container.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  MODULE_LEVEL,
  diffImportSites,
  enclosingDeclaration,
  readerFileProblems
} from "../scripts/lib/exemption-guards";
import {
  OPERATOR_ONLY_TARGETS,
  RUNNER_BEGIN,
  RUNNER_END,
  UNTRACEABLE_IMPORT_SITES,
  renderRunnerRefusal,
  spliceRunnerRefusal
} from "../scripts/jobs-env-allowlist";
import { readImports } from "../scripts/lib/job-import-graph";
import { stripComments } from "../scripts/lib/source-text";

const ring = ["readRing", "readRingUnchecked"];

const reader = (extra: string): string =>
  stripComments(`export const RETENTION_DAYS = 30;

export function readRingUnchecked(env = process.env) {
  return parse(env.SECRET_RING);
}

export function readRing(env = process.env) {
  return check(readRingUnchecked(env));
}
${extra}`);

describe("enclosingDeclaration", () => {
  const source = `import { x } from "./x";
const LIMIT = 5;

export async function first() {
  return 1;
}

class Holder {
  method() {
    return first();
  }
}

type Alias = ReturnType<typeof first>;
`;

  test("names the function, the constant and the class a reference is in", () => {
    expect(enclosingDeclaration(source, source.indexOf("return 1"))).toBe(
      "first"
    );
    expect(enclosingDeclaration(source, source.indexOf("5;"))).toBe("LIMIT");
    expect(enclosingDeclaration(source, source.indexOf("return first"))).toBe(
      "class Holder"
    );
  });

  test("a `type` or a statement after a function is module level, not folded into it", () => {
    expect(enclosingDeclaration(source, source.indexOf("ReturnType"))).toBe(
      MODULE_LEVEL
    );
    expect(enclosingDeclaration(source, 3)).toBe(MODULE_LEVEL);
  });
});

describe("a REACHES_WITHOUT_READING reader file is a closed set", () => {
  test("the unmodified file passes", () => {
    expect(readerFileProblems("f.ts", reader(""), "SECRET_RING", ring)).toEqual(
      []
    );
  });

  test("FIRES on a new helper that calls a reader internally", () => {
    const problems = readerFileProblems(
      "f.ts",
      reader(`
export function ringFingerprint(env = process.env) {
  return hash(readRing(env));
}
`),
      "SECRET_RING",
      ring
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("ringFingerprint references readRing");
  });

  test("FIRES on an arrow function, a constant initialised at import time and a class method", () => {
    for (const extra of [
      "export const viaArrow = () => readRing();\n",
      "export const EAGER = readRing();\n",
      "export class Svc {\n  get() {\n    return readRing();\n  }\n}\n"
    ]) {
      expect(
        readerFileProblems("f.ts", reader(extra), "SECRET_RING", ring),
        extra
      ).not.toEqual([]);
    }
  });

  test("FIRES when a class follows a reader function (it is not folded into that function)", () => {
    const problems = readerFileProblems(
      "f.ts",
      reader("\nclass Sneaky {\n  go() {\n    return readRing();\n  }\n}\n"),
      "SECRET_RING",
      ring
    );
    expect(problems.join("\n")).toContain("class Sneaky");
  });

  test("FIRES on a second function that reads the variable directly", () => {
    const problems = readerFileProblems(
      "f.ts",
      reader(`
export function readRawRing() {
  return process.env.SECRET_RING;
}
`),
      "SECRET_RING",
      ring
    );
    expect(problems.join("\n")).toContain("readRawRing reads SECRET_RING");
  });

  test("FIRES on a read through a name literal, and on a destructuring read", () => {
    for (const body of [
      'return readConfigured("SECRET_RING");',
      "const { SECRET_RING } = process.env;\n  return SECRET_RING;"
    ]) {
      expect(
        readerFileProblems(
          "f.ts",
          reader(`\nexport function other() {\n  ${body}\n}\n`),
          "SECRET_RING",
          ring
        ),
        body
      ).not.toEqual([]);
    }
  });

  test("a message that merely contains the name is not a read", () => {
    expect(
      readerFileProblems(
        "f.ts",
        reader('\nconst MESSAGE = "SECRET_RING must not be empty";\n'),
        "SECRET_RING",
        ring
      )
    ).toEqual([]);
  });
});

describe("UNTRACEABLE_IMPORT_SITES is keyed by file AND expression", () => {
  const listed = [
    { file: "scripts/gate.ts", expression: "`${process.cwd()}/${file}`" }
  ];

  test("the listed site alone is explained", () => {
    expect(diffImportSites(listed, listed)).toEqual({
      unexplained: [],
      stale: []
    });
  });

  test("FIRES on a second, different computed import in the listed file", () => {
    const found = [
      ...listed,
      { file: "scripts/gate.ts", expression: "someOtherPath" }
    ];
    expect(diffImportSites(found, listed).unexplained).toEqual([
      { file: "scripts/gate.ts", expression: "someOtherPath" }
    ]);
  });

  test("FIRES on a second occurrence of the SAME expression", () => {
    expect(
      diffImportSites([...listed, ...listed], listed).unexplained
    ).toHaveLength(1);
  });

  test("FIRES on a changed expression, and reports the old entry as stale", () => {
    const found = [{ file: "scripts/gate.ts", expression: "somethingElse" }];
    const diff = diffImportSites(found, listed);
    expect(diff.unexplained).toEqual(found);
    expect(diff.stale).toEqual(listed);
  });

  test("the tracer reports the whole expression, nested calls and templates included", () => {
    const { dynamic } = readImports(
      [
        "const a = await import(`${process.cwd()}/${file}`);",
        "const b = await import(\n  pathToFileURL(join(root, 'x)y')).href\n);",
        "const c = await import(`${base(`${deep})`)}/z`);"
      ].join("\n")
    );
    expect(dynamic).toEqual([
      "`${process.cwd()}/${file}`",
      "pathToFileURL(join(root, 'x)y')).href",
      "`${base(`${deep})`)}/z`"
    ]);
  });

  test("a formatter re-wrapping the expression does not change its key", () => {
    expect(
      readImports("await import(\n  `${process.cwd()}/${file}`\n);").dynamic
    ).toEqual(readImports("await import(`${process.cwd()}/${file}`);").dynamic);
  });

  test("every real entry has a reason and an expression", () => {
    for (const entry of UNTRACEABLE_IMPORT_SITES) {
      expect(entry.expression.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });
});

describe("ops/run-job.sh refuses operator-only targets", () => {
  const RUNNER = "ops/run-job.sh";
  const sandbox = mkdtempSync(path.join(tmpdir(), "run-job-operator-"));
  const marker = path.join(sandbox, "docker-was-called");
  const stub = path.join(sandbox, "bin");

  // A stub `docker` that records that it ran. `docker ps` prints nothing, so a
  // target that gets PAST the refusal stops at "app container not running" -
  // which proves the refusal was not what stopped it.
  Bun.spawnSync(["mkdir", "-p", stub]);
  writeFileSync(
    path.join(stub, "docker"),
    `#!/bin/sh\necho "$@" >> "${marker}"\nexit 0\n`
  );
  chmodSync(path.join(stub, "docker"), 0o755);

  afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

  function run(...args: string[]): {
    exitCode: number;
    stderr: string;
    stdout: string;
  } {
    const proc = Bun.spawnSync(["bash", RUNNER, ...args], {
      env: {
        ...process.env,
        PATH: `${stub}:${process.env.PATH ?? ""}`,
        AWCMS_JOBS_IMAGE: "stub/awcms-jobs:test"
      }
    });
    return {
      exitCode: proc.exitCode ?? -1,
      stderr: proc.stderr.toString(),
      stdout: proc.stdout.toString()
    };
  }

  test("there is something to refuse", () => {
    expect(OPERATOR_ONLY_TARGETS.length).toBeGreaterThanOrEqual(5);
  });

  for (const entry of OPERATOR_ONLY_TARGETS) {
    test(`${entry.target} (${entry.kind}) exits non-zero before docker is called`, () => {
      const result = run(entry.target);
      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(
        `${entry.target} is an operator-only command`
      );
      expect(existsSync(marker)).toBe(false);
    });
  }

  test("extra arguments do not get an operator-only target past the refusal", () => {
    const result = run("security:readiness", "--json");
    expect(result.exitCode).toBe(1);
    expect(existsSync(marker)).toBe(false);
  });

  test("a path or option cannot name the same script around the refusal", () => {
    for (const target of [
      "./scripts/security-readiness.ts",
      "scripts/security-readiness.ts",
      "--help",
      "security:readiness ",
      "security:readiness;true"
    ]) {
      const result = run(target);
      expect(result.exitCode, target).toBe(1);
      expect(result.stderr, target).toContain("package script name");
    }
    expect(existsSync(marker)).toBe(false);
  });

  test("an ordinary job is NOT refused by the guard (it proceeds to the app-container check)", () => {
    const result = run("email:dispatch", "--dry-run");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("app container not running");
    expect(result.stderr).not.toContain("operator-only");
    // The stub was consulted, i.e. the runner got past the guard to docker.
    expect(existsSync(marker)).toBe(true);
  });
});

describe("the generated refusal block", () => {
  test("lists every OPERATOR_ONLY target, sorted, between the markers", () => {
    const block = renderRunnerRefusal(
      OPERATOR_ONLY_TARGETS.map((entry) => entry.target)
    );
    expect(block.startsWith(RUNNER_BEGIN)).toBe(true);
    expect(block.endsWith(RUNNER_END)).toBe(true);
    for (const entry of OPERATOR_ONLY_TARGETS) {
      expect(block).toContain(entry.target);
    }
  });

  test("splicing replaces only what is between the markers and is idempotent", () => {
    const block = renderRunnerRefusal(["a:b", "c"]);
    const source = `before\n${RUNNER_BEGIN}\nold\n${RUNNER_END}\nafter\n`;
    const once = spliceRunnerRefusal(source, block) as string;
    expect(once.startsWith("before\n")).toBe(true);
    expect(once.endsWith("\nafter\n")).toBe(true);
    expect(once).not.toContain("\nold\n");
    expect(spliceRunnerRefusal(once, block)).toBe(once);
  });

  test("a runner without the markers is reported, never silently left unguarded", () => {
    expect(spliceRunnerRefusal("#!/bin/bash\nexit 0\n", "x")).toBeNull();
  });

  test("a target that is not a plain script name cannot be rendered into the shell", () => {
    for (const bad of ["a b", "x;rm", "$(id)", "a|b", "", "-n", "*"]) {
      expect(() => renderRunnerRefusal(["ok:target", bad]), bad).toThrow();
    }
    expect(() => renderRunnerRefusal([])).toThrow();
  });
});
