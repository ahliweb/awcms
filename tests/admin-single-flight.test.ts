/**
 * Single flight is the default for every form (Issue #1224).
 *
 * Two layers, tested at the layer each lives in:
 *
 * 1. `createSingleFlight` is a pure state machine behind three injected ports,
 *    so its contract (ignore a second run, release in `finally`, keep a held
 *    key until `release()`) is asserted with a recorder and no DOM at all.
 * 2. The DOM adapter — `onSubmit`/`onSubmitAll`/`onAction`, `lockElement`,
 *    `mutateAndReload`, the `pageshow` restore — is asserted against a minimal
 *    fake `document` (this repo registers no DOM shim for unit tests), which is
 *    enough because the helpers only use `getElementById`, `closest`,
 *    attributes, `disabled`/`textContent` and `addEventListener`. The
 *    browser-level proof (a real double click on a real form) is
 *    `tests/e2e/admin-offices-double-submit.e2e.ts` and
 *    `tests/e2e/login-double-submit.e2e.ts`.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  createSingleFlight,
  holdForNavigation,
  lockElement,
  mutateAndReload,
  onAction,
  onSubmit,
  onSubmitAll,
  restoreOnPageShow,
  type FlightPorts
} from "../src/lib/ui/admin-form-client";

/* ------------------------------------------------------------------ */
/* 1. The pure state machine                                          */
/* ------------------------------------------------------------------ */

function recorder(holds: (key: string) => boolean = () => false) {
  const events: string[] = [];
  const ports: FlightPorts<string> = {
    enter: (key) => events.push(`enter:${key}`),
    leave: (key) => events.push(`leave:${key}`),
    holds
  };

  return { events, flight: createSingleFlight(ports) };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

describe("createSingleFlight", () => {
  test("a second run while the first is pending runs nothing and queues nothing", async () => {
    const { flight, events } = recorder();
    const gate = deferred();
    let calls = 0;

    const first = flight.run("a", async () => {
      calls += 1;
      await gate.promise;
    });
    const second = await flight.run("a", async () => {
      calls += 1;
    });

    expect(second).toBe(false);
    gate.resolve();
    expect(await first).toBe(true);
    // Not queued: nothing ran after the first settled either.
    expect(calls).toBe(1);
    expect(events).toEqual(["enter:a", "leave:a"]);
  });

  test("the key is released when the task throws, and the error still surfaces", async () => {
    const { flight, events } = recorder();

    await expect(
      flight.run("a", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(events).toEqual(["enter:a", "leave:a"]);
    // ...so the next attempt is accepted.
    expect(await flight.run("a", () => undefined)).toBe(true);
  });

  test("a throw ALWAYS releases, even when holds() would say the page still holds a lock", async () => {
    // Mirrors the DOM adapter: `holds` is true once the handler ran
    // `lockElement` and never unlocked (the control's `page` flag).
    let pageLocked = false;
    const { flight, events } = recorder(() => pageLocked);

    await expect(
      flight.run("a", async () => {
        pageLocked = true; // lockElement(submit, "Saving…") ...
        throw new Error("boom"); // ... then a throw before unlock()
      })
    ).rejects.toThrow("boom");

    expect(events).toEqual(["enter:a", "leave:a"]);
    // The key is free: the next run starts instead of being ignored.
    expect(await flight.run("a", () => undefined)).toBe(true);
  });

  test("the key is released on an { ok: false } outcome (a settled task is a settled task)", async () => {
    const { flight } = recorder();

    await flight.run("a", async () => ({ ok: false, errorCode: "X" }));

    expect(await flight.run("a", () => undefined)).toBe(true);
  });

  test("different keys are independent", async () => {
    const { flight } = recorder();
    const gate = deferred();

    const first = flight.run("a", () => gate.promise);

    expect(await flight.run("b", () => undefined)).toBe(true);
    gate.resolve();
    await first;
  });

  test("a held key stays busy after the task settles, until release()", async () => {
    let navigating = true;
    const { flight, events } = recorder(() => navigating);

    await flight.run("a", () => undefined);
    expect(events).toEqual(["enter:a"]);
    expect(await flight.run("a", () => undefined)).toBe(false);

    navigating = false;
    flight.release();
    expect(events).toEqual(["enter:a", "leave:a"]);
    expect(await flight.run("a", () => undefined)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 2. The DOM adapter, against a minimal fake document                */
/* ------------------------------------------------------------------ */

type Listener = (event: Record<string, unknown>) => void;

class FakeElement {
  attributes = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  classes = new Set<string>();
  id = "";
  parent: FakeElement | null = null;

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  /** `.class` selectors only — all the helpers under test are given. */
  closest(selector: string): FakeElement | null {
    return this.classes.has(selector.slice(1)) ? this : null;
  }
  fire(type: string, event: Record<string, unknown> = {}): boolean {
    let prevented = false;
    const full = {
      target: this,
      preventDefault: () => {
        prevented = true;
      },
      ...event
    };

    for (const listener of this.listeners.get(type) ?? []) listener(full);

    return prevented;
  }
}

class FakeButton extends FakeElement {
  disabled = false;
  textContent: string | null;

  constructor(label: string) {
    super();
    this.textContent = label;
  }
}

class FakeForm extends FakeElement {
  submit: FakeButton | null = null;

  querySelector(): FakeButton | null {
    return this.submit;
  }
}

const registry = new Map<string, FakeElement>();
const documentListeners = new Map<string, Listener[]>();
const requests: string[] = [];
const reloads: number[] = [];
const windowListeners = new Map<string, Listener[]>();

const g = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};

beforeAll(() => {
  for (const key of [
    "document",
    "window",
    "Element",
    "HTMLButtonElement",
    "HTMLFormElement",
    "FormData"
  ]) {
    saved[key] = g[key];
  }

  g.Element = FakeElement;
  g.HTMLButtonElement = FakeButton;
  g.HTMLFormElement = FakeForm;
  g.FormData = class {};
  g.document = {
    getElementById: (id: string) => registry.get(id) ?? null,
    querySelector: () => null,
    documentElement: new FakeElement(),
    addEventListener: (type: string, listener: Listener) => {
      documentListeners.set(type, [
        ...(documentListeners.get(type) ?? []),
        listener
      ]);
    }
  };
  g.window = {
    addEventListener: (type: string, listener: Listener) => {
      windowListeners.set(type, [
        ...(windowListeners.get(type) ?? []),
        listener
      ]);
    },
    location: { reload: () => reloads.push(1) }
  };
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete g[key];
    else g[key] = value;
  }
});

beforeEach(() => {
  registry.clear();
  documentListeners.clear();
  requests.length = 0;
  reloads.length = 0;
});

function makeForm(id: string): { form: FakeForm; submit: FakeButton } {
  const form = new FakeForm();
  const submit = new FakeButton("Save");
  form.id = id;
  form.submit = submit;
  registry.set(id, form);

  return { form, submit };
}

/** A tick that lets awaited microtasks (and the `finally` after them) run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

describe("onSubmit: single flight", () => {
  test("a second submit while the handler is pending sends no second request", async () => {
    const { form } = makeForm("f");
    const gate = deferred();
    onSubmit("f", async () => {
      requests.push("POST");
      await gate.promise;
    });

    const first = form.fire("submit");
    const second = form.fire("submit");
    gate.resolve();
    await settle();

    expect(requests).toEqual(["POST"]);
    // The ignored event is STILL cancelled: it must never fall through to a
    // native POST (the Enter-key / implicit-submission path, decision 4).
    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  test("while pending: aria-busy on the form, submit disabled, label untouched", async () => {
    const { form, submit } = makeForm("f");
    const gate = deferred();
    onSubmit("f", () => gate.promise);

    form.fire("submit");
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe("Save");

    gate.resolve();
    await settle();

    expect(form.getAttribute("aria-busy")).toBeNull();
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe("Save");
  });

  test("released after an { ok: false } outcome, so the user can retry", async () => {
    const { form } = makeForm("f");
    onSubmit("f", async () => {
      requests.push("POST");
      // A page reports `{ ok: false }` through its message box and returns; the
      // guard only cares that the promise settled.
    });

    form.fire("submit");
    await settle();
    form.fire("submit");
    await settle();

    expect(requests).toEqual(["POST", "POST"]);
  });

  test("a page that also calls lockElement keeps ITS busy label, and release restores the original", async () => {
    const { form, submit } = makeForm("f");
    const gate = deferred();
    let unlock = () => {};
    onSubmit("f", async ({ submit: button }) => {
      unlock = lockElement(button!, "Saving…");
      await gate.promise;
    });

    form.fire("submit");
    expect(submit.textContent).toBe("Saving…");
    expect(submit.disabled).toBe(true);

    // Failure path: the page unlocks itself, as it always has.
    unlock();
    expect(submit.textContent).toBe("Save");
    expect(submit.disabled).toBe(false);

    gate.resolve();
    await settle();
    expect(submit.textContent).toBe("Save");
    expect(submit.disabled).toBe(false);
  });

  test("a page lock left held on success (it is navigating) keeps the whole form locked", async () => {
    const { form, submit } = makeForm("f");
    onSubmit("f", async ({ submit: button }) => {
      lockElement(button!, "Saving…"); // never unlocked: success navigates
    });

    form.fire("submit");
    await settle();

    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe("Saving…");
    expect(form.getAttribute("aria-busy")).toBe("true");
    // ...and a further submit is still ignored.
    const calls = requests.length;
    form.fire("submit");
    await settle();
    expect(requests.length).toBe(calls);

    restoreOnPageShow({ persisted: true });
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe("Save");
    expect(form.getAttribute("aria-busy")).toBeNull();
  });

  test("holdForNavigation keeps a form locked that the page never lockElement'd", async () => {
    const { form, submit } = makeForm("f");
    let holding = true;
    onSubmit("f", async () => {
      if (holding) holdForNavigation();
      else requests.push("again");
    });

    form.fire("submit");
    await settle();

    expect(submit.disabled).toBe(true);
    expect(form.getAttribute("aria-busy")).toBe("true");

    restoreOnPageShow({ persisted: true });
    expect(submit.disabled).toBe(false);
    expect(form.getAttribute("aria-busy")).toBeNull();

    // Restored for real: the same listener accepts a submit again.
    holding = false;
    form.fire("submit");
    await settle();
    expect(requests).toEqual(["again"]);
  });

  test("pageshow WITHOUT persisted (a normal load) restores nothing", async () => {
    const { form, submit } = makeForm("f");
    onSubmit("f", async () => {
      holdForNavigation();
    });

    form.fire("submit");
    await settle();
    restoreOnPageShow({ persisted: false });

    expect(submit.disabled).toBe(true);
    restoreOnPageShow({ persisted: true }); // leave the module clean
  });

  test("release() leaves a disabled value the page set during the flight", async () => {
    const { form, submit } = makeForm("f");
    const gate = deferred();
    onSubmit("f", () => gate.promise);

    form.fire("submit");
    expect(submit.disabled).toBe(true);
    submit.disabled = false; // page-owned change during the flight
    gate.resolve();
    await settle();
    expect(submit.disabled).toBe(false);
  });

  test("the pageshow listener the module registered releases held locks (persisted only)", async () => {
    const { form, submit } = makeForm("f");
    onSubmit("f", async () => {
      holdForNavigation();
    });

    form.fire("submit");
    await settle();
    expect(submit.disabled).toBe(true);

    const listeners = windowListeners.get("pageshow") ?? [];
    expect(listeners.length).toBe(1);
    for (const listener of listeners) listener({ persisted: false });
    expect(submit.disabled).toBe(true);
    for (const listener of listeners) listener({ persisted: true });
    expect(submit.disabled).toBe(false);
    expect(form.getAttribute("aria-busy")).toBeNull();
  });

  test("the navigation hold is one-shot: a concurrent flight on another form settles normally", async () => {
    const a = makeForm("a");
    const b = makeForm("b");
    const gate = deferred();
    onSubmit("a", async () => {
      holdForNavigation();
    });
    onSubmit("b", () => gate.promise);

    b.form.fire("submit");
    a.form.fire("submit");
    await settle();
    expect(a.submit.disabled).toBe(true); // a is navigating: held

    gate.resolve();
    await settle();
    expect(b.submit.disabled).toBe(false); // b is not
    restoreOnPageShow({ persisted: true });
  });

  test("a hold that never navigates is released after 10 s (page still alive)", async () => {
    const { form, submit } = makeForm("f");
    onSubmit("f", async () => {
      holdForNavigation();
    });
    const realSetTimeout = globalThis.setTimeout;
    let fire: (() => void) | undefined;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      if (ms === 1e4) {
        fire = fn;
        return 0;
      }
      return realSetTimeout(fn, ms);
    }) as unknown as typeof setTimeout;

    try {
      form.fire("submit");
      await settle();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }

    expect(submit.disabled).toBe(true);
    fire!();
    expect(submit.disabled).toBe(false);
    expect(form.getAttribute("aria-busy")).toBeNull();
  });

  test("mutateAndReload on success holds the lock through the reload", async () => {
    const { form, submit } = makeForm("f");
    onSubmit("f", async ({ submit: button }) => {
      await mutateAndReload(
        button,
        { show: () => {}, clear: () => {} },
        async () => ({ ok: true, errorCode: null }),
        "failed",
        "Please wait…"
      );
    });

    form.fire("submit");
    await settle();

    expect(reloads).toEqual([1]);
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe("Please wait…");
    restoreOnPageShow({ persisted: true });
    expect(submit.textContent).toBe("Save");
  });

  test("mutateAndReload on failure unlocks, so the retry is accepted", async () => {
    const { form, submit } = makeForm("f");
    onSubmit("f", async ({ submit: button }) => {
      requests.push("POST");
      await mutateAndReload(
        button,
        { show: () => {}, clear: () => {} },
        async () => ({ ok: false, errorCode: "X" }),
        "failed",
        "Please wait…"
      );
    });

    form.fire("submit");
    await settle();
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe("Save");

    form.fire("submit");
    await settle();
    expect(requests).toEqual(["POST", "POST"]);
  });
});

describe("lockElement", () => {
  test("is idempotent: a second lock never captures the busy label as the original", () => {
    const button = new FakeButton("Save");
    const asButton = button as unknown as HTMLButtonElement;

    const first = lockElement(asButton, "Saving…");
    const second = lockElement(asButton, "Still saving…");

    expect(button.textContent).toBe("Still saving…");
    expect(button.disabled).toBe(true);

    second();
    expect(button.textContent).toBe("Save");
    expect(button.disabled).toBe(false);

    // The other unlock is now a no-op, not a second restore of stale state.
    button.textContent = "Changed since";
    first();
    expect(button.textContent).toBe("Changed since");
  });

  test("a stale unlock cannot release a LATER lock of the same button", () => {
    const button = new FakeButton("Save");
    const asButton = button as unknown as HTMLButtonElement;

    const stale = lockElement(asButton, "One…");
    stale();
    lockElement(asButton, "Two…");
    stale();

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Two…");
    restoreOnPageShow({ persisted: true });
  });

  test("restores exactly what was there: an already-disabled button stays disabled", () => {
    const button = new FakeButton("Save");
    button.disabled = true;

    lockElement(button as unknown as HTMLButtonElement, "Saving…")();

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Save");
  });
});

describe("onAction: single flight per button", () => {
  test("a second click on the SAME button is ignored; another button is not", async () => {
    const one = new FakeButton("Delete");
    const two = new FakeButton("Delete");
    one.classes.add("act");
    two.classes.add("act");
    const gate = deferred();
    onAction(".act", async (button) => {
      requests.push(button === (one as unknown) ? "one" : "two");
      await gate.promise;
    });
    const click = (target: FakeButton) => {
      for (const listener of documentListeners.get("click") ?? []) {
        listener({ target, preventDefault: () => {} });
      }
    };

    click(one);
    click(one);
    click(two);

    expect(requests).toEqual(["one", "two"]);
    expect(one.getAttribute("aria-busy")).toBe("true");
    expect(one.disabled).toBe(true);

    gate.resolve();
    await settle();

    expect(one.disabled).toBe(false);
    expect(one.getAttribute("aria-busy")).toBeNull();
    click(one);
    expect(requests).toEqual(["one", "two", "one"]);
  });
});

describe("onSubmitAll: single flight per form", () => {
  test("a second submit of the same row form is ignored, a sibling row is not", async () => {
    const a = makeForm("a");
    const b = makeForm("b");
    a.form.classes.add("row");
    b.form.classes.add("row");
    const gate = deferred();
    onSubmitAll(".row", async ({ form }) => {
      requests.push(form === (a.form as unknown) ? "a" : "b");
      await gate.promise;
    });
    const submit = (target: FakeForm) => {
      let prevented = false;
      for (const listener of documentListeners.get("submit") ?? []) {
        listener({
          target,
          preventDefault: () => {
            prevented = true;
          }
        });
      }

      return prevented;
    };

    expect(submit(a.form)).toBe(true);
    expect(submit(a.form)).toBe(true);
    submit(b.form);

    expect(requests).toEqual(["a", "b"]);
    gate.resolve();
    await settle();
  });
});
