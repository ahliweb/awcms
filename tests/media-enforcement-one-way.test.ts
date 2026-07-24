import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { mediaLibraryModule } from "../src/modules/media-library/module";
import { MEDIA_ENFORCEMENT_PERMISSIONS } from "../src/modules/media-library/domain/media-permissions";

/**
 * Managed-media enforcement is ONE-WAY by construction (ADR-0036 step 5a).
 *
 * This is a security property, not an unfinished API, and it is the kind of
 * thing a well-meaning future change destroys while "completing" the surface:
 * adding `enforcement.disable` for symmetry, an `unmarkManagedMediaEnforced`
 * next to the mark function, or a DELETE in a cleanup job would each restore
 * exactly the exploit `sql/043`'s header records as confirmed-exploitable — a
 * tenant switching off its own media reference validation.
 *
 * None of those would fail a typecheck, and none would fail any other gate in
 * this repo. So they are asserted here, against the source itself.
 */

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }

  return out;
}

describe("managed-media enforcement is one-way (ADR-0036 step 5a)", () => {
  test("the module declares enforcement.read and enforcement.enable — and no disable", () => {
    const enforcement = (mediaLibraryModule.permissions ?? []).filter(
      (p) => p.activityCode === "enforcement"
    );

    expect(enforcement.map((p) => p.action).sort()).toEqual(["enable", "read"]);

    for (const permission of enforcement) {
      expect(permission.action).not.toBe("disable");
      expect(permission.action).not.toBe("delete");
    }

    expect(Object.values(MEDIA_ENFORCEMENT_PERMISSIONS)).toEqual([
      "media_library.enforcement.read",
      "media_library.enforcement.enable"
    ]);
  });

  test("no media_library source file exposes an unmark/clear/disable function for the enforcement flag", () => {
    const forbidden = [
      "unmarkManagedMediaEnforced",
      "clearManagedMediaEnforced",
      "disableManagedMediaEnforcement",
      "revokeManagedMediaEnforcement"
    ];

    const files = listSourceFiles("src/modules/media-library");
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const name of forbidden) {
        expect({ file, declares: source.includes(`function ${name}`) }).toEqual(
          {
            file,
            declares: false
          }
        );
      }
    }
  });

  test("nothing anywhere DELETEs from the enforcement state table", () => {
    // The flag's security value comes entirely from rows never going away. A
    // DELETE in any module, job, or cleanup path is equivalent to a disable
    // button, however it is spelled. `sql/` is excluded on purpose: a migration
    // is allowed to reference the table; what must never exist is application
    // code that removes one tenant's row.
    const files = listSourceFiles("src/modules").concat(
      listSourceFiles("src/pages")
    );
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const normalized = source.replace(/\s+/g, " ");

      if (/DELETE FROM awcms_media_library_tenant_state/i.test(normalized)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the enforcement route exports GET and POST only — no DELETE handler", () => {
    const route = readFileSync("src/pages/api/v1/media/enforcement.ts", "utf8");

    const exported = [...route.matchAll(/^export const (\w+): APIRoute/gm)].map(
      (match) => match[1] as string
    );

    expect(exported.sort()).toEqual(["GET", "POST"]);
    expect(exported).not.toContain("DELETE");
    expect(exported).not.toContain("PATCH");
    expect(exported).not.toContain("PUT");
  });

  test("the enable POST requires an Idempotency-Key (enforcement.enable is HIGH_RISK)", () => {
    // `enforcement.enable` ∈ HIGH_RISK_ACTIONS, and the go-live convention
    // requires idempotency on every high-risk mutation. Guard against a future
    // edit silently dropping the header requirement.
    const route = readFileSync("src/pages/api/v1/media/enforcement.ts", "utf8");
    expect(route).toContain('request.headers.get("idempotency-key")');
    expect(route).toContain("IDEMPOTENCY_REQUIRED");
    expect(route).toContain("saveIdempotencyRecord");
  });
});
