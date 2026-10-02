/**
 * Command palette opt-in page items (Issue ahliweb/omes#267). Pure: a minimal
 * fake DOM stands in for the browser (the repo ships no DOM library), enough
 * for `initAdminCommandPalette` — dialog, input, `<li data-search>` results,
 * `querySelector(All)` over `tag[attr]` / `[attr]` / `tag`, events and click().
 *
 * Pins: (1) a page with NO `data-command-palette-item` element behaves exactly
 * as before (same list, same filter, nothing added); (2) marked elements are
 * indexed with their label (the optional label attribute, else textContent),
 * filtered with the rest, activated by `element.click()` after the dialog
 * closes, re-read on every open (no duplicates, a removed element disappears),
 * and never fetched, evaluated or turned into a command.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { initAdminCommandPalette } from "../src/lib/ui/admin-command-palette";

type Listener = (event: FakeEvent) => void;
type FakeEvent = {
  key?: string;
  target?: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
};

class FakeNode {
  parent: FakeNode | null = null;
  children: FakeNode[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  hidden = false;
  className = "";
  href = "";
  clicks = 0;
  private text = "";

  constructor(public tag: string) {}

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(value: string) {
    this.children = [];
    this.text = value;
  }
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  contains(node: FakeNode): boolean {
    for (let n: FakeNode | null = node; n; n = n.parent)
      if (n === this) return true;
    return false;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? (this.attrs.get(name) as string) : null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...init
    };
    event.target ??= this;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  click(): void {
    this.clicks += 1;
    this.dispatch("click");
  }
  private all(): FakeNode[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelectorAll(selector: string): FakeNode[] {
    const match = /^([a-z]*)(?:\[([a-z-]+)\])?$/.exec(selector);
    if (!match) throw new Error(`unsupported selector ${selector}`);
    const [, tag, attr] = match;
    return this.all().filter(
      (n) => (!tag || n.tag === tag) && (!attr || n.hasAttribute(attr))
    );
  }
  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class FakeDialog extends FakeNode {
  open = false;
  showModal(): void {
    this.open = true;
  }
  close(): void {
    this.open = false;
  }
}
class FakeInput extends FakeNode {
  value = "";
  focused = false;
  focus(): void {
    this.focused = true;
  }
}

type World = {
  dialog: FakeDialog;
  input: FakeInput;
  results: FakeNode;
  empty: FakeNode;
  openButton: FakeNode;
  body: FakeNode;
  navItems: FakeNode[];
};

const GLOBALS = [
  "document",
  "HTMLDialogElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLElement"
] as const;
const saved = new Map<string, unknown>();

function nav(label: string, group: string, path: string): FakeNode {
  const li = new FakeNode("li");
  li.setAttribute("data-search", `${label} ${group} ${path}`.toLowerCase());
  const a = new FakeNode("a");
  a.href = path;
  li.append(a);
  return li;
}

function build(): World {
  const dialog = new FakeDialog("dialog");
  const input = new FakeInput("input");
  const results = new FakeNode("ul");
  const empty = new FakeNode("p");
  const navItems = [
    nav("Servers", "OMES", "/admin/omes/servers"),
    nav("Jobs", "OMES", "/admin/omes/jobs")
  ];
  results.append(...navItems);
  dialog.append(input, results, empty);
  const openButton = new FakeNode("button");
  const body = new FakeNode("body");
  body.append(dialog, openButton);
  const byId = new Map<string, FakeNode>([
    ["admin-palette", dialog],
    ["admin-palette-input", input],
    ["admin-palette-empty", empty],
    ["admin-palette-open", openButton]
  ]);
  const doc = Object.assign(new FakeNode("document"), {
    activeElement: null as unknown,
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: (tag: string) => new FakeNode(tag),
    body
  });
  // `document.querySelectorAll` searches the whole page, dialog included.
  doc.append(body);
  Object.assign(globalThis, {
    document: doc,
    HTMLDialogElement: FakeDialog,
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: class {},
    HTMLElement: FakeNode
  });
  return { dialog, input, results, empty, openButton, body, navItems };
}

function marked(
  world: World,
  tag: "button" | "a",
  text: string,
  label?: string
): FakeNode {
  const node = new FakeNode(tag);
  node.setAttribute("data-command-palette-item", "");
  if (label !== undefined)
    node.setAttribute("data-command-palette-label", label);
  node.textContent = text;
  world.body.append(node);
  return node;
}

const visible = (world: World): string[] =>
  world.results.children
    .filter((li) => !li.hidden)
    .map((li) => li.getAttribute("data-search") ?? "");
const injected = (world: World): FakeNode[] =>
  world.results.children.filter((li) => li.hasAttribute("data-page-item"));

function open(world: World): void {
  world.openButton.dispatch("click");
}
function type(world: World, value: string): void {
  world.input.value = value;
  world.input.dispatch("input");
}

beforeEach(() => {
  for (const name of GLOBALS)
    saved.set(name, (globalThis as Record<string, unknown>)[name]);
});
afterEach(() => {
  for (const name of GLOBALS) {
    const previous = saved.get(name);
    if (previous === undefined)
      delete (globalThis as Record<string, unknown>)[name];
    else (globalThis as Record<string, unknown>)[name] = previous;
  }
});

describe("a page with no data-command-palette-item element (backward compatible)", () => {
  test("opens with exactly the nav entries and adds nothing", () => {
    const world = build();
    initAdminCommandPalette();
    open(world);

    expect(world.dialog.open).toBe(true);
    expect(world.input.focused).toBe(true);
    expect(world.results.children).toHaveLength(2);
    expect(injected(world)).toHaveLength(0);
    expect(world.empty.hidden).toBe(true);
  });

  test("filters by the server-lowercased haystack and shows the empty notice on no match", () => {
    const world = build();
    initAdminCommandPalette();
    open(world);

    type(world, "JOBS");
    expect(world.navItems.map((li) => li.hidden)).toEqual([true, false]);
    type(world, "nothing-matches");
    expect(world.navItems.every((li) => li.hidden)).toBe(true);
    expect(world.empty.hidden).toBe(false);
    type(world, "");
    expect(world.navItems.every((li) => !li.hidden)).toBe(true);
  });

  test("does nothing at all when the shell has no palette", () => {
    const world = build();
    world.dialog.remove();
    (
      globalThis as unknown as { document: { getElementById: () => null } }
    ).document.getElementById = () => null;
    expect(() => initAdminCommandPalette()).not.toThrow();
    expect(injected(world)).toHaveLength(0);
  });
});

describe("a page that marks elements", () => {
  test("indexes each marked element: label attribute first, else normalized textContent; empty labels are skipped", () => {
    const world = build();
    marked(world, "button", "  Server \n  srv-1  OK  ", "Server: srv-1");
    marked(world, "a", "Open   details\nfor srv-1");
    marked(world, "button", "   ");
    initAdminCommandPalette();
    open(world);

    expect(injected(world).map((li) => li.textContent)).toEqual([
      "Server: srv-1",
      "Open details for srv-1"
    ]);
    expect(world.results.children).toHaveLength(4);
    const first = injected(world)[0] as FakeNode;
    expect(first.getAttribute("data-search")).toBe("server: srv-1");
    // Rendered as an <a href="#" role="button"> so the existing styling and
    // arrow-key navigation (which look for the first <a>) apply unchanged.
    const link = first.querySelector("a") as FakeNode;
    expect(link.href).toBe("#");
    expect(link.getAttribute("role")).toBe("button");
  });

  test("page items are filtered together with the screen entries", () => {
    const world = build();
    marked(world, "button", "x", "Server: srv-1");
    marked(world, "button", "x", "Job: status");
    initAdminCommandPalette();
    open(world);

    type(world, "srv-1");
    expect(visible(world)).toEqual(["server: srv-1"]);
    type(world, "job");
    expect(visible(world)).toEqual([
      "jobs omes /admin/omes/jobs",
      "job: status"
    ]);
  });

  test("activating an item closes the palette, then clicks the real element (and only that one)", () => {
    const world = build();
    const target = marked(world, "button", "x", "Server: srv-1");
    const other = marked(world, "button", "x", "Server: srv-2");
    initAdminCommandPalette();
    open(world);

    const link = (injected(world)[0] as FakeNode).querySelector(
      "a"
    ) as FakeNode;
    const event = link.dispatch("click");

    expect(event.defaultPrevented).toBe(true);
    expect(world.dialog.open).toBe(false);
    expect(target.clicks).toBe(1);
    expect(other.clicks).toBe(0);
  });

  test("Space activates too (the item is role=button); other keys do not", () => {
    const world = build();
    const target = marked(world, "button", "x", "Server: srv-1");
    initAdminCommandPalette();
    open(world);

    const link = (injected(world)[0] as FakeNode).querySelector(
      "a"
    ) as FakeNode;
    link.dispatch("keydown", { key: "ArrowDown" });
    expect(target.clicks).toBe(0);
    link.dispatch("keydown", { key: " " });
    expect(target.clicks).toBe(1);
  });

  test("every open re-reads the page: no duplicates, removed elements disappear, new ones appear", () => {
    const world = build();
    const first = marked(world, "button", "x", "Server: srv-1");
    initAdminCommandPalette();
    open(world);
    world.dialog.close();
    open(world);
    expect(injected(world)).toHaveLength(1);

    first.remove();
    marked(world, "button", "x", "Job: job-9");
    world.dialog.close();
    open(world);
    expect(injected(world).map((li) => li.textContent)).toEqual(["Job: job-9"]);
  });

  test("marked elements inside the palette itself are ignored", () => {
    const world = build();
    const inside = new FakeNode("button");
    inside.setAttribute("data-command-palette-item", "");
    inside.textContent = "inside";
    world.dialog.append(inside);
    initAdminCommandPalette();
    open(world);
    expect(injected(world)).toHaveLength(0);
  });

  test("the number of added items is bounded", () => {
    const world = build();
    for (let i = 0; i < 1100; i += 1) marked(world, "button", "x", `Item ${i}`);
    initAdminCommandPalette();
    open(world);
    expect(injected(world)).toHaveLength(1000);
  });

  test("a label is written as text, never parsed as HTML", () => {
    const world = build();
    marked(world, "button", "x", "<img src=x onerror=alert(1)>");
    initAdminCommandPalette();
    open(world);
    const label = (injected(world)[0] as FakeNode).querySelector("a")
      ?.children[0] as FakeNode;
    expect(label.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(label.children).toHaveLength(0);
  });
});
