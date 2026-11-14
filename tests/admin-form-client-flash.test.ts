/**
 * The flash message that survives a reload (`flashAndReload` / `showFlash`).
 *
 * Every admin mutation reloads on success, which made success silent: on
 * `/admin/invitations` a resend worked and the screen said nothing. The
 * primitive remembers WHICH of the page's own messages to show across that
 * reload, and shows it once.
 *
 * What these tests pin is the safety shape, not just the happy path: storage
 * carries a short catalog key and never text; only a message the page itself
 * rendered into `data-flash-<key>` can appear; the key is cleared as soon as it
 * is read; and blocked storage never breaks the reload.
 *
 * Runs against a minimal fake `window`/`document`/`sessionStorage`, because the
 * helpers touch exactly those three and nothing else.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { flashAndReload, showFlash } from "../src/lib/ui/admin-form-client";

type FakeElement = {
  textContent: string;
  hidden: boolean;
  scrolled: boolean;
  attrs: Record<string, string>;
  getAttribute(name: string): string | null;
  scrollIntoView(): void;
};

const globals = globalThis as unknown as Record<string, unknown>;
const GLOBAL_NAMES = ["sessionStorage", "window", "document"];
const saved: Record<string, unknown> = {};
let store: Map<string, string>;
let reloads: number;
let element: FakeElement;
let currentPath = "/admin/invitations";

function makeElement(attrs: Record<string, string>): FakeElement {
  return {
    textContent: "",
    hidden: true,
    scrolled: false,
    attrs,
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    },
    scrollIntoView() {
      this.scrolled = true;
    }
  };
}

function install(options: { throwingStorage?: boolean } = {}): void {
  store = new Map();
  reloads = 0;
  element = makeElement({
    "data-flash-resent": "Invitation sent again.",
    "data-flash-revoked": "Invitation revoked."
  });

  globals.sessionStorage = options.throwingStorage
    ? {
        getItem() {
          throw new Error("blocked");
        },
        setItem() {
          throw new Error("blocked");
        },
        removeItem() {
          throw new Error("blocked");
        }
      }
    : {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key)
      };
  globals.window = {
    location: {
      get pathname() {
        return currentPath;
      },
      reload: () => void (reloads += 1)
    },
    addEventListener: () => {}
  };
  globals.document = {
    getElementById: (id: string) =>
      id === "status-box" ? (element as unknown) : null
  };
}

beforeEach(() => {
  for (const key of GLOBAL_NAMES) saved[key] = globals[key];
});

afterEach(() => {
  for (const key of GLOBAL_NAMES) globals[key] = saved[key];
});

describe("flashAndReload / showFlash", () => {
  test("the page's own sentence for the key survives the reload, shows once, and scrolls into view", () => {
    install();

    flashAndReload("resent");
    expect(reloads).toBe(1);

    showFlash("status-box");
    expect(element.textContent).toBe("Invitation sent again.");
    expect(element.hidden).toBe(false);
    expect(element.scrolled).toBe(true);

    // Shown ONCE: a later plain reload must not replay a stale success.
    element = makeElement({ "data-flash-resent": "Invitation sent again." });
    showFlash("status-box");
    expect(element.hidden).toBe(true);
  });

  test("storage holds the key only, never message text", () => {
    install();

    flashAndReload("revoked");

    expect([...store.values()].map((v) => JSON.parse(v).key)).toEqual([
      "revoked"
    ]);
    for (const v of store.values()) expect(v).not.toContain("Invitation");
  });

  test("the key is cleared when read, even when the page has no sentence for it", () => {
    install();

    flashAndReload("unknown-key");
    showFlash("status-box");

    expect(element.hidden).toBe(true);
    expect(element.textContent).toBe("");
    expect(store.size).toBe(0);
  });

  test("free text or markup is never stored, shown or executed: a non-key is refused outright", () => {
    install();

    for (const hostile of [
      "<img src=x onerror=alert(1)>",
      "Invitation resent.",
      "",
      "a".repeat(41),
      "UPPER"
    ]) {
      flashAndReload(hostile);
    }

    expect(reloads).toBe(5);
    expect(store.size).toBe(0);
    showFlash("status-box");
    expect(element.hidden).toBe(true);
  });

  test("a value planted in storage by something else is only ever a lookup key", () => {
    install();
    store.set("awcms.admin.flash", "<b>planted</b>");

    showFlash("status-box");

    expect(element.hidden).toBe(true);
    expect(element.textContent).toBe("");
    expect(store.size).toBe(0);
  });

  test("a flash recorded on another page never shows here, and is forgotten", () => {
    install();

    currentPath = "/admin/somewhere-else";
    flashAndReload("resent");
    currentPath = "/admin/invitations";
    showFlash("status-box");

    expect(element.hidden).toBe(true);
    expect(store.size).toBe(0);
    currentPath = "/admin/invitations";
  });

  test("a stale flash (older than the window) is dropped, a fresh one shows", () => {
    install();
    const realNow = Date.now;

    try {
      Date.now = () => 1_000_000;
      flashAndReload("resent");
      Date.now = () => 1_000_000 + 11_000;
      showFlash("status-box");
      expect(element.hidden).toBe(true);
      expect(store.size).toBe(0);

      Date.now = () => 2_000_000;
      flashAndReload("resent");
      Date.now = () => 2_000_000 + 2_000;
      showFlash("status-box");
      expect(element.textContent).toBe("Invitation sent again.");
    } finally {
      Date.now = realNow;
    }
  });

  test("a record without a path or timestamp (the old bare-key shape) is refused", () => {
    install();
    store.set("awcms.admin.flash", "resent");
    showFlash("status-box");
    expect(element.hidden).toBe(true);

    store.set("awcms.admin.flash", JSON.stringify({ key: "resent" }));
    showFlash("status-box");
    expect(element.hidden).toBe(true);
    expect(store.size).toBe(0);
  });

  test("nothing remembered leaves the box hidden", () => {
    install();

    showFlash("status-box");

    expect(element.hidden).toBe(true);
  });

  test("blocked storage still reloads and never throws", () => {
    install({ throwingStorage: true });

    expect(() => flashAndReload("resent")).not.toThrow();
    expect(reloads).toBe(1);
    expect(() => showFlash("status-box")).not.toThrow();
    expect(element.hidden).toBe(true);
  });

  test("a missing status region does not throw, and the key is still forgotten", () => {
    install();

    flashAndReload("resent");
    expect(() => showFlash("no-such-box")).not.toThrow();
    expect(store.size).toBe(0);
  });
});
