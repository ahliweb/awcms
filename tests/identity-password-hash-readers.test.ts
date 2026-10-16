/**
 * #1035 - there is ONE way to ask "does this string match the password this
 * person signs in with": the login rule (the principal's credential once
 * promoted, the identity's own `password_hash` only until then).
 *
 * `awcms_identities.password_hash` is a per-tenant copy that goes stale when the
 * password is changed from another tenant, so a file that reads it directly and
 * compares against it accepts a password the person has already replaced. That
 * is exactly the cross-tenant takeover #1035 closed in `password-change.ts`.
 *
 * ## What counts as a READ
 *
 * Any SQL text (a template literal) that names `awcms_identities` - with or
 * without the `public.` schema prefix, in a plain SELECT or a JOIN - and
 *
 *   - selects `password_hash`, or
 *   - selects `*` / `alias.*` (which includes it), or
 *   - returns it (`RETURNING password_hash` / `RETURNING *`).
 *
 * Writes (`INSERT ... password_hash`, `UPDATE ... SET password_hash`) are fine:
 * the column has to be written by the code that creates and changes
 * credentials. Scanned: `src/**` (.ts, .astro, .mjs) and `scripts/**`.
 *
 * Pure: reads source text. Adding a file to ALLOWED is a review decision about
 * widening who may verify a password, and it should be argued in the PR.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = [
  // The login rule itself: reads the identity hash only as the fallback.
  "src/pages/api/v1/auth/login.ts",
  // The shared verifier everything else calls.
  "src/modules/identity-access/application/current-password.ts"
];

const SCAN_ROOTS = ["src", "scripts"];
const SCAN_EXTENSIONS = [".ts", ".astro", ".mjs"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SCAN_EXTENSIONS.some((ext) => path.endsWith(ext))) out.push(path);
  }

  return out;
}

const NAMES_IDENTITIES = /\b(?:public\.)?awcms_identities\b/i;
const SELECTS_HASH = /\bSELECT\b[\s\S]*?\bpassword_hash\b/i;
const SELECTS_STAR = /\bSELECT\s+(?:DISTINCT\s+)?(?:[a-z_]+\.)?\*/i;
const RETURNS_HASH_OR_STAR =
  /\bRETURNING\b[^;]*?(?:\bpassword_hash\b|[\s,](?:[a-z_]+\.)?\*)/i;

/** True when one SQL text reads an identity's stored password hash. */
export function readsIdentityPasswordHash(sqlText: string): boolean {
  if (!NAMES_IDENTITIES.test(sqlText)) return false;

  return (
    SELECTS_HASH.test(sqlText) ||
    SELECTS_STAR.test(sqlText) ||
    RETURNS_HASH_OR_STAR.test(sqlText)
  );
}

/** Every template literal in a file - the unit a SQL statement lives in. */
function templateLiterals(source: string): string[] {
  return source.match(/`(?:\\[\s\S]|[^`\\])*`/g) ?? [];
}

describe("only the login rule and the shared verifier read an identity's password hash", () => {
  test("no other file reads awcms_identities.password_hash", () => {
    const offenders = SCAN_ROOTS.flatMap((root) => walk(root))
      .filter((file) =>
        templateLiterals(readFileSync(file, "utf8")).some(
          readsIdentityPasswordHash
        )
      )
      .filter((file) => !ALLOWED.includes(file))
      .sort();

    expect(offenders).toEqual([]);
  });

  test("the detector catches every shape the audit listed", () => {
    // Plain select, a join, the schema-qualified name, SELECT *, alias.*,
    // and RETURNING of the column or of everything.
    const reads = [
      "SELECT password_hash, principal_id FROM awcms_identities WHERE id = ${id}",
      "SELECT id, status,\n password_hash\n FROM awcms_identities",
      "SELECT p.id, i.password_hash FROM awcms_principals p JOIN awcms_identities i ON i.principal_id = p.id",
      "SELECT i.id, p.email FROM awcms_principals p\n JOIN public.awcms_identities i ON i.principal_id = p.id\n WHERE i.password_hash IS NOT NULL AND 1 = 1 ORDER BY i.password_hash",
      "SELECT password_hash FROM public.awcms_identities",
      "SELECT * FROM awcms_identities WHERE id = ${id}",
      "SELECT i.* FROM awcms_identities i",
      "SELECT DISTINCT * FROM public.awcms_identities",
      "UPDATE awcms_identities SET updated_at = now() WHERE id = ${id} RETURNING password_hash",
      "UPDATE public.awcms_identities SET updated_at = now() RETURNING *",
      "UPDATE awcms_identities SET updated_at = now() RETURNING id, i.*"
    ];

    for (const text of reads) {
      expect([text, readsIdentityPasswordHash(text)]).toEqual([text, true]);
    }
  });

  test("and leaves legitimate writes and unrelated reads alone", () => {
    const fine = [
      "SELECT id FROM awcms_identities WHERE tenant_id = ${t}",
      "SELECT id, status, login_identifier FROM public.awcms_identities",
      "INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash, status) VALUES (${a}, ${b}, ${c}, ${d}, 'active')",
      "UPDATE awcms_identities SET password_hash = ${hash}, failed_login_count = 0 WHERE id = ${id}",
      "UPDATE awcms_identities SET updated_at = now() WHERE id = ${id} RETURNING id",
      "SELECT password_hash FROM awcms_principals WHERE id = ${id}",
      "SELECT count(*)::int FROM awcms_sessions"
    ];

    for (const text of fine) {
      expect([text, readsIdentityPasswordHash(text)]).toEqual([text, false]);
    }
  });

  test("the allow-list is not stale: every entry still reads it", () => {
    for (const file of ALLOWED) {
      expect(
        templateLiterals(readFileSync(file, "utf8")).some(
          readsIdentityPasswordHash
        )
      ).toBe(true);
    }
  });
});
