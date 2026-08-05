/**
 * `checkResponseCompressionOwnership` — the C3 gate, driven with planted trees.
 *
 * C3 is not "this repo is slow". It is that the compression readers actually
 * receive comes from Cloudflare — a layer this repo neither ships nor checks —
 * while nothing in the repo says so, which makes a deployment outside a
 * compressing CDN silently serve every text response raw. The closure C3's own
 * table prescribes is a declaration in `security:readiness`; a declaration that
 * cannot go red is a sentence, so what is asserted here is that the check FAILS
 * on the two shapes it exists for (the declaration deleted, the declaration
 * emptied) and reports the *other* state — compression owned here — instead of
 * repeating the inherited story once it stops being true.
 *
 * The last test runs against the real tree. That is the one that goes red the
 * day someone deletes the marked block from `environments.md`, and it runs in
 * `bun run check` (via `bun test`) even though `security:readiness` itself
 * deliberately does not.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  checkResponseCompressionOwnership,
  INHERITED_COMPRESSION_DOC,
  INHERITED_COMPRESSION_MARKER_END,
  INHERITED_COMPRESSION_MARKER_START,
  OWNED_RESPONSE_LAYER_FILES
} from "../scripts/security-readiness";

const tempRoots: string[] = [];

async function plantTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "compression-ownership-"));
  tempRoots.push(root);

  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }

  return root;
}

function declaration(body: string): string {
  return [
    "## Cache tepi",
    "",
    INHERITED_COMPRESSION_MARKER_START,
    "",
    body,
    "",
    INHERITED_COMPRESSION_MARKER_END,
    ""
  ].join("\n");
}

const REAL_DECLARATION =
  "**Tier pengompresi adalah Cloudflare** — lapisan paling kiri pada topologi.";

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("checkResponseCompressionOwnership — inherited, and declared", () => {
  test("passes and quotes the declaration when no owned layer compresses", async () => {
    const root = await plantTree({
      "src/middleware.ts": "export const onRequest = () => {};\n",
      "infra/varnish/default.vcl": "sub vcl_backend_response {\n}\n",
      [INHERITED_COMPRESSION_DOC]: declaration(REAL_DECLARATION)
    });

    const result = await checkResponseCompressionOwnership(root);

    expect(result.status).toBe("pass");
    expect(result.severity).toBe("warning");
    expect(result.evidence).toContain("Cloudflare");
    // The operator instruction is the point of the pass branch: the tier that
    // compresses is not in this tree, so "green here" must not read as "green
    // at the edge of the environment you are about to launch".
    expect(result.evidence).toContain("content-encoding");
  });

  test("treats an absent optional layer as compressing nothing, not as a finding", async () => {
    const root = await plantTree({
      [INHERITED_COMPRESSION_DOC]: declaration(REAL_DECLARATION)
    });

    const result = await checkResponseCompressionOwnership(root);

    expect(result.status).toBe("pass");
    expect(result.evidence).toContain("No layer this repo ships compresses");
  });
});

describe("checkResponseCompressionOwnership — the declaration goes missing", () => {
  test("fails when the marked block is deleted", async () => {
    const root = await plantTree({
      "src/middleware.ts": "export const onRequest = () => {};\n",
      [INHERITED_COMPRESSION_DOC]: "## Cache tepi\n\nTopologi saja.\n"
    });

    const result = await checkResponseCompressionOwnership(root);

    expect(result.status).toBe("fail");
    expect(result.severity).toBe("warning");
    expect(result.evidence).toContain(INHERITED_COMPRESSION_MARKER_START);
  });

  test("fails when the markers survive but the block is emptied", async () => {
    const root = await plantTree({
      [INHERITED_COMPRESSION_DOC]: declaration("   \n\n  ")
    });

    const result = await checkResponseCompressionOwnership(root);

    expect(result.status).toBe("fail");
  });

  test("fails when only the opening marker is left", async () => {
    const root = await plantTree({
      [INHERITED_COMPRESSION_DOC]: `## Cache tepi\n\n${INHERITED_COMPRESSION_MARKER_START}\n\n${REAL_DECLARATION}\n`
    });

    const result = await checkResponseCompressionOwnership(root);

    expect(result.status).toBe("fail");
  });

  test("fails when the document itself is gone", async () => {
    const root = await plantTree({
      "src/middleware.ts": "export const onRequest = () => {};\n"
    });

    const result = await checkResponseCompressionOwnership(root);

    expect(result.status).toBe("fail");
    expect(result.evidence).toContain(INHERITED_COMPRESSION_DOC);
  });
});

describe("checkResponseCompressionOwnership — compression becomes owned", () => {
  test("reports the file and line, and demands the stale declaration be rewritten", async () => {
    const root = await plantTree({
      "infra/varnish/default.vcl": [
        "sub vcl_backend_response {",
        "  set beresp.do_gzip = true;",
        "}"
      ].join("\n"),
      [INHERITED_COMPRESSION_DOC]: declaration(REAL_DECLARATION)
    });

    const result = await checkResponseCompressionOwnership(root);

    expect(result.status).toBe("pass");
    expect(result.evidence).toContain("infra/varnish/default.vcl:2");
    // Without this half the gate would go quiet at exactly the moment the
    // declaration it just passed on became a lie.
    expect(result.evidence).toContain(INHERITED_COMPRESSION_DOC);
  });

  test("detects a Traefik compress middleware declared by the repo", async () => {
    const root = await plantTree({
      "infra/varnish/docker-compose.varnish.yml": [
        "services:",
        "  varnish:",
        "    labels:",
        "      - traefik.http.middlewares.awcms-compress.compress=true"
      ].join("\n"),
      [INHERITED_COMPRESSION_DOC]: declaration(REAL_DECLARATION)
    });

    const result = await checkResponseCompressionOwnership(root);

    expect(result.evidence).toContain(
      "infra/varnish/docker-compose.varnish.yml:4"
    );
  });

  test("a comment that mentions compression is not compression", async () => {
    const root = await plantTree({
      "infra/varnish/default.vcl": [
        "sub vcl_backend_response {",
        "  # beresp.do_gzip is deliberately NOT set — Cloudflare compresses.",
        "}"
      ].join("\n"),
      [INHERITED_COMPRESSION_DOC]: declaration(REAL_DECLARATION)
    });

    const result = await checkResponseCompressionOwnership(root);

    expect(result.status).toBe("pass");
    expect(result.evidence).toContain("No layer this repo ships compresses");
    expect(result.evidence).not.toContain("default.vcl:2");
  });

  test("`Vary: Accept-Encoding` is a promise about caching, not an act of compressing", async () => {
    const root = await plantTree({
      "src/middleware.ts": 'headers.set("Vary", "Accept-Encoding");\n',
      [INHERITED_COMPRESSION_DOC]: declaration(REAL_DECLARATION)
    });

    const result = await checkResponseCompressionOwnership(root);

    expect(result.evidence).toContain("No layer this repo ships compresses");
  });
});

describe("checkResponseCompressionOwnership — the real tree", () => {
  test("this repo declares its inherited compression today", async () => {
    const result = await checkResponseCompressionOwnership();

    expect(result.status).toBe("pass");
    expect(result.evidence).toContain(INHERITED_COMPRESSION_DOC);
  });

  test("every layer it claims to check is a path this repo could actually ship", () => {
    // A path list that drifts into names that no longer exist would scan
    // nothing and pass forever. `infra/` is optional, so existence is not
    // asserted — shape is: repo-relative, no globs, no escaping upwards.
    for (const relative of OWNED_RESPONSE_LAYER_FILES) {
      expect(path.isAbsolute(relative)).toBe(false);
      expect(relative).not.toContain("*");
      expect(relative).not.toContain("..");
    }

    expect(OWNED_RESPONSE_LAYER_FILES).toContain("src/middleware.ts");
    expect(OWNED_RESPONSE_LAYER_FILES).toContain("infra/varnish/default.vcl");
  });
});
