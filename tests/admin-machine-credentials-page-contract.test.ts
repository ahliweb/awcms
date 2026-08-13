/**
 * `/admin/machine-credentials` gates against the endpoints it drives — ADR-0049,
 * ADR-0092, #539.
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE
 * — including the owner — while still looking like a working screen. This repo
 * has shipped that bug twice by inventing a plausible action name.
 *
 * This screen sets three traps of its own:
 *
 * - **Issuing spans TWO permissions.** `machine_credentials.create` mints the
 *   read-only class and `machine_credentials_write.create` mints the write one.
 *   A page that gated the whole form on either alone would either hide issuance
 *   from everybody who may only mint read credentials, or offer a write control
 *   that 403s at submit.
 * - **The token is readable exactly once.** A reload after issuing spends a
 *   credential nobody can use and somebody has to revoke.
 * - **Revoke is a `POST` to `/revoke`, not a `DELETE`.** A page that guessed
 *   the verb would render a working-looking button that answers 405 at the one
 *   moment it matters.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS } from "../src/modules/identity-access/domain/machine-credential";

const PAGE = "src/pages/admin/machine-credentials.astro";
const LIST_ROUTE = "src/pages/api/v1/access/machine-credentials/index.ts";
const REVOKE_ROUTE =
  "src/pages/api/v1/access/machine-credentials/[id]/revoke.ts";

/**
 * Collapses runs of whitespace.
 *
 * Two assertions below are about ADJACENCY — that a verb sits next to its URL,
 * that a ternary tests the write list — and the formatter decides where those
 * break across lines. Matching raw source would make prettier's line-wrapping a
 * reason for this file to go red on correct code, which is the failure mode
 * `/admin/partners` already recorded once.
 */
function squashed(source: string): string {
  return source.replace(/\s+/g, " ");
}

const EXPECTED = [
  "identity_access.machine_credentials.read",
  "identity_access.machine_credentials.create",
  "identity_access.machine_credentials.revoke",
  "identity_access.machine_credentials_write.create"
];

describe("/admin/machine-credentials gates on keys that really exist", () => {
  test("every key the page names is DECLARED by a module", async () => {
    const page = await readFile(PAGE, "utf8");

    const declared = new Set<string>();
    for (const module of listModules()) {
      for (const permission of module.permissions ?? []) {
        declared.add(
          `${module.key}.${permission.activityCode}.${permission.action}`
        );
      }
    }

    for (const key of EXPECTED) {
      const [, activityCode, action] = key.split(".");
      expect(page).toContain(`activityCode: "${activityCode}"`);
      expect(page).toContain(`action: "${action}"`);
      expect(declared.has(key)).toBe(true);
    }
  });

  test("the page names BOTH issuance activities, not one standing in for both", async () => {
    const page = await readFile(PAGE, "utf8");

    // The whole point of ADR-0092's split. If the page resolved the write
    // fieldset from `machine_credentials.create`, every holder of the read
    // permission would be shown a control they cannot use — and the split that
    // kept the grant from widening would be undone in the UI instead.
    expect(page).toContain('activityCode: "machine_credentials_write"');
    expect(page).toContain('activityCode: "machine_credentials"');
    expect(page).toContain("canCreateWrite");
  });

  test("the page and its endpoints agree on the activity", async () => {
    for (const route of [LIST_ROUTE, REVOKE_ROUTE]) {
      const source = await readFile(route, "utf8");
      expect(source).toContain('activityCode: "machine_credentials"');
    }
  });

  test("revoking is gated on `revoke`, and it is a POST to /revoke", async () => {
    const page = squashed(await readFile(PAGE, "utf8"));
    const route = await readFile(REVOKE_ROUTE, "utf8");

    // `revoke` is split from `create` on purpose (ADR-0049): during an incident
    // somebody must be able to kill a leaked credential without also being able
    // to mint one.
    expect(route).toContain('action: "revoke"');
    expect(route).toContain("export const POST");
    expect(page).toContain(
      '"POST", `/api/v1/access/machine-credentials/${credentialId}/revoke`'
    );
  });
});

describe("the three properties this surface exists to keep", () => {
  test("issuing does NOT reload — the token would be lost", async () => {
    const page = await readFile(PAGE, "utf8");

    const issueBlock = page.slice(
      page.indexOf('onSubmit("issue-credential-form"'),
      page.indexOf('onAction(".js-revoke-credential"')
    );

    // Paired with the assertions below so an empty slice — a marker that
    // stopped matching — cannot satisfy `not.toContain` vacuously.
    expect(issueBlock.length).toBeGreaterThan(200);
    expect(issueBlock).toContain("sendJsonForData");
    expect(issueBlock).toContain("result.data?.token");
    expect(issueBlock).not.toContain("window.location.reload()");
  });

  test("the write-action checkboxes are DERIVED from the live ceiling", async () => {
    const page = await readFile(PAGE, "utf8");

    // A hand-written pair of checkboxes would still render `create`/`update`
    // correctly today and silently omit whatever a future ADR adds — the form
    // falling behind the constant, with nothing red.
    expect(page).toContain("MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS");
    expect(page).toContain("writeActions.map(");
    for (const action of MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS) {
      expect(page).not.toContain(`value="${action}"`);
    }
  });

  test("CIDRs are sent ONLY with a write class, matching what the API accepts", async () => {
    const page = await readFile(PAGE, "utf8");

    // The API refuses `allowedIpCidrs` on a read-only credential, because the
    // guard never consults them there — a binding that reads as enforced and is
    // not. A page that always sent the field would turn that honest refusal
    // into a 422 on every read-only issuance.
    expect(squashed(page)).toContain("allowedWriteActions.length ?");
  });

  test("the expiry ceiling narrows with the write class", async () => {
    const page = await readFile(PAGE, "utf8");

    // Server-enforced either way; done here so the shorter limit is visible
    // while choosing rather than as a 422 after the form is filled in.
    expect(page).toContain("MACHINE_CREDENTIAL_WRITE_MAX_LIFETIME_DAYS");
    expect(page).toContain("syncExpiryCeiling");
    expect(page).toContain("dataset.maxWrite");
  });
});

describe("the ledger shrank, and stayed shrunk", () => {
  test("no machine-credential key is left on NOT_YET_SCREENED", async () => {
    const { NOT_YET_SCREENED } =
      await import("../scripts/admin-screen-coverage-ledger");

    expect(
      NOT_YET_SCREENED.filter((key) => key.includes("machine_credential"))
    ).toEqual([]);
  });

  test("and the four keys are exactly the ones this page claims", () => {
    // Paired with the assertion above so neither can pass vacuously: an empty
    // ledger slice proves nothing if the page stopped naming the keys.
    expect(EXPECTED).toHaveLength(4);
  });
});
