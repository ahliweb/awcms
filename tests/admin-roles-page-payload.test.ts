/**
 * PROJECT_STATE §4 **C6** — `/admin/roles` used to render the whole permission
 * catalogue as `<option>`s once per role.
 *
 * ~230 catalogue rows x up to 100 roles is ~23,000 options in one document, of
 * which at most one is ever chosen, and the growth is silent: the screen looks
 * identical, it just gets heavier with every role the tenant adds. The
 * catalogue is now emitted ONCE inside a `<template>` — inert content, not
 * rendered and not submitted — and the client clones it into a role's picker
 * the first time that role's panel is opened.
 *
 * Asserted from the source rather than from a rendered page because the defect
 * is structural: it is the per-role LOOP over the catalogue that has to be
 * gone, and a rendered snapshot of a two-role fixture would look fine either
 * way.
 *
 * Comments are stripped first — the prose above the code names the very
 * constructs being asserted absent, and a substring check that reads comments
 * answers about the documentation instead of the code.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/lib/source-text";

const PAGE = "src/pages/admin/roles.astro";
const ROLE_ADMIN = "src/modules/identity-access/application/role-admin.ts";

describe("the catalogue is sent once, not once per role", () => {
  test("it is rendered inside a single template element", async () => {
    const page = stripComments(await readFile(PAGE, "utf8"));

    expect(page).toContain('<template id="permission-catalog-options">');
    expect(page.split('id="permission-catalog-options"')).toHaveLength(2);
  });

  test("no per-role option loop remains", async () => {
    const page = stripComments(await readFile(PAGE, "utf8"));

    // The row renderer must not carry the catalogue at all — the surviving
    // `catalog.map` is the template's, outside the `rows.map`.
    const rowsAt = page.indexOf("rows.map(");
    const rowBody = page.slice(rowsAt, page.indexOf("<template", rowsAt));

    expect(rowsAt).toBeGreaterThan(-1);
    expect(rowBody).not.toContain("available.map(");
    expect(rowBody).not.toContain("catalog.map(");
  });

  test("the row still decides whether a picker is offered at all", async () => {
    const page = stripComments(await readFile(PAGE, "utf8"));

    // Without this the server would render an empty picker for a role that
    // already holds everything, and the client would have nothing to put in
    // it — a control that cannot succeed.
    expect(page).toContain("availableCount > 0");
    expect(page).toContain("availableCount:");
  });

  test("the picker is filled from the template, minus what the panel lists as granted", async () => {
    const page = stripComments(await readFile(PAGE, "utf8"));

    expect(page).toContain("select[data-role-grant-select]");
    expect(page).toContain("permission-catalog-options");
    expect(page).toContain("[data-permission-id]");
    // First open, not page load: cloning ~230 options per role up front would
    // move the cost rather than remove it.
    expect(page).toContain('addEventListener("toggle"');
  });
});

describe("the grants are read in one round trip", () => {
  test("the screen uses the batched reader", async () => {
    const page = stripComments(await readFile(PAGE, "utf8"));

    expect(page).toContain("listRolePermissionsForRoles(");
  });

  test("no per-role grant query survives anywhere", async () => {
    const page = stripComments(await readFile(PAGE, "utf8"));
    const roleAdmin = stripComments(await readFile(ROLE_ADMIN, "utf8"));

    // The single-role reader is GONE rather than merely unused: an export with
    // no callers is how the next screen quietly reintroduces the N+1.
    expect(page).not.toContain("listRolePermissions(");
    expect(roleAdmin).not.toContain(
      "export async function listRolePermissions("
    );
  });
});
