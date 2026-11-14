/**
 * `holdForNavigation` arms the bfcache `pageshow` restore once PER WINDOW.
 *
 * It used to arm once per process behind a boolean. In a browser that is the
 * same thing, but `bun test` runs every file in one process and each file
 * installs its own fake `window`: whichever file called `holdForNavigation`
 * first (the flash test, whose `addEventListener` is a no-op) consumed the one
 * arming, and `admin-single-flight.test.ts` then found no listener. Which file
 * ran first depended on the order the runner picked, so CI went red on a PR
 * that touched neither file.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";

import { holdForNavigation } from "../src/lib/ui/admin-form-client";

type Listener = (event: { persisted?: boolean }) => void;

const g = globalThis as Record<string, unknown>;
let savedWindow: unknown;

function fakeWindow(): { window: unknown; listeners: Map<string, Listener[]> } {
  const listeners = new Map<string, Listener[]>();
  return {
    listeners,
    window: {
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      location: { reload: () => {} }
    }
  };
}

beforeAll(() => {
  savedWindow = g.window;
});

afterAll(() => {
  if (savedWindow === undefined) delete g.window;
  else g.window = savedWindow;
});

test("a second window gets its own pageshow listener; the same window is not armed twice", () => {
  const first = fakeWindow();
  g.window = first.window;
  holdForNavigation();
  holdForNavigation();
  expect(first.listeners.get("pageshow")?.length).toBe(1);

  const second = fakeWindow();
  g.window = second.window;
  holdForNavigation();
  expect(second.listeners.get("pageshow")?.length).toBe(1);
  expect(first.listeners.get("pageshow")?.length).toBe(1);

  // release the hold so no later file inherits a locked state
  for (const listener of second.listeners.get("pageshow") ?? [])
    listener({ persisted: true });
});
