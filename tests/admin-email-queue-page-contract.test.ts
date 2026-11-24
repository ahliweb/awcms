/**
 * `/admin/email-queue` gates against the endpoints it drives (Issue #1162,
 * Issue #499 for the endpoints).
 *
 * Pinned: the two permissions are declared, seeded and enforced; the list is
 * keyset-paged (never a bare LIMIT); the recipient is the masked column and the
 * raw address is never selected; cancel is offered only for a status the
 * endpoint can still cancel; the one mutation maps only codes the route emits.
 *
 * Pure: no database, no network.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { stripComments } from "../scripts/lib/source-text";
import {
  isCancellableMessageStatus,
  messageStatusLabel,
  messageStatusTone
} from "../src/lib/i18n/labels/email-webhooks";
import { getTranslatorFor } from "../src/lib/i18n";

const PAGE = "src/pages/admin/email-queue.astro";
const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const page = read(PAGE);

function literalGuard(source: string, name: string) {
  const match = new RegExp(
    `const ${name} = \\{\\s*moduleKey: "([a-z_]+)",\\s*activityCode: "([a-z_]+)",\\s*action: "([a-z_]+)"\\s*\\} as const;`
  ).exec(source);

  expect(match).not.toBeNull();

  return { moduleKey: match![1], activityCode: match![2], action: match![3] };
}

describe("the screen gates on keys that really exist", () => {
  test("each literal guard equals the endpoint's own guard", () => {
    const list = read("src/pages/api/v1/email/messages/index.ts");
    const cancel = read("src/pages/api/v1/email/messages/[id]/cancel.ts");

    // The routes write `action: "read" as const`; the page writes the whole
    // object `as const`. Same three literals either way.
    const routeGuard = (source: string, name: string) => {
      const match = new RegExp(
        `const ${name} = \\{\\s*moduleKey: "([a-z_]+)",\\s*activityCode: "([a-z_]+)",\\s*action: "([a-z_]+)" as const\\s*\\};`
      ).exec(source);

      expect(match).not.toBeNull();

      return {
        moduleKey: match![1],
        activityCode: match![2],
        action: match![3]
      };
    };

    expect(literalGuard(page, "READ_GUARD")).toEqual(
      routeGuard(list, "READ_GUARD")
    );
    expect(literalGuard(page, "CANCEL_GUARD")).toEqual(
      routeGuard(cancel, "CANCEL_GUARD")
    );
  });

  test("both keys are DECLARED by the email module and SEEDED by a migration", () => {
    const email = listModules().find((module) => module.key === "email")!;
    const declared = new Set(
      (email.permissions ?? []).map(
        (permission) => `${permission.activityCode}.${permission.action}`
      )
    );

    for (const key of ["message.read", "message.cancel"]) {
      expect(declared.has(key)).toBe(true);
    }

    const seeded = read("sql/014_awcms_email_schema.sql");

    expect(seeded).toContain("'message', 'read'");
    expect(seeded).toContain("'message', 'cancel'");
  });

  test("the sidebar entry opens this page on the key the page accepts", () => {
    const email = listModules().find((module) => module.key === "email")!;

    expect(email.navigation).toContainEqual(
      expect.objectContaining({
        path: "/admin/email-queue",
        requiredPermission: "email.message.read"
      })
    );
    expect(page).toContain("authorize: READ_GUARD");
    expect(page).toContain("can({ ...CANCEL_GUARD })");
    expect(page).not.toContain("ssr.permissions.has");
  });
});

describe("the list is bounded and masked", () => {
  test("it is keyset-paged by an opaque cursor, and a filter change drops the cursor", () => {
    expect(page).toContain("decodeKeysetCursor(rawCursor)");
    expect(page).toContain("fetchEmailMessageEntries(");
    expect(page).toContain('rel="next"');
    // `filterHref` builds `?status=` only: no `cursor` rides along.
    expect(page).toMatch(
      /function filterHref[\s\S]*?\{\s*return value === null \? PATH : `\$\{PATH\}\?status=\$\{value\}`;/
    );
  });

  test("the recipient is the masked column; the raw address is never selected", () => {
    expect(page).toContain("message.toAddressMasked");
    expect(page).not.toContain("to_address");
    expect(
      read("src/modules/email/application/email-message-directory.ts")
    ).not.toMatch(/SELECT[^;]*\bto_address,/);
  });

  test("the script touches no web storage", () => {
    expect(page).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
});

describe("cancel is offered only where the endpoint can still do it", () => {
  test("the label helper agrees with the directory's own rule", () => {
    const directory = read(
      "src/modules/email/application/email-message-directory.ts"
    );

    expect(directory).toContain(
      'existing.status !== "queued" && existing.status !== "retry_wait"'
    );

    for (const status of [
      "queued",
      "sending",
      "sent",
      "failed",
      "retry_wait",
      "cancelled",
      "suppressed"
    ]) {
      expect(isCancellableMessageStatus(status)).toBe(
        status === "queued" || status === "retry_wait"
      );
    }
  });

  test("a non-cancellable row says so instead of hiding the column", () => {
    expect(page).toContain("isCancellableMessageStatus(message.status)");
    expect(page).toContain('t("Cannot be cancelled now")');
  });

  test("it asks for a confirmation and maps only codes the route emits", () => {
    const script = page.slice(page.lastIndexOf("<script>"));
    const route = read("src/pages/api/v1/email/messages/[id]/cancel.ts");

    expect(script).toContain('confirmAction(say("confirmCancel"))');
    expect(script).toMatch(
      /import \{[\s\S]*?\} from "..\/..\/lib\/ui\/admin-form-client"/
    );
    expect(script.match(/sendJson\(/g)?.length).toBe(1);

    const shared = ["RATE_LIMITED", "ACCESS_DENIED"];

    for (const [, code] of script.matchAll(/case "([A-Z_]+)":/g)) {
      expect(route.includes(`"${code}"`) || shared.includes(code!)).toBe(true);
    }
  });
});

describe("states and labels", () => {
  test("denied and error have their own elements", () => {
    for (const id of ["email-queue-denied", "email-queue-error"]) {
      expect(page).toContain(`id="${id}"`);
    }
  });

  test("every status the queue can hold has a label and a tone", () => {
    const { t } = getTranslatorFor("en");

    for (const status of [
      "queued",
      "sending",
      "sent",
      "failed",
      "retry_wait",
      "cancelled",
      "suppressed"
    ]) {
      expect(messageStatusLabel(t, status)).not.toBe(status);
      expect(messageStatusTone(status)).toBeTruthy();
    }
  });
});
