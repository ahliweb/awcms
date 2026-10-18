/**
 * Which push-enrolment guidance applies to THIS browser (Issue #1105).
 *
 * iOS/iPadOS (16.4+) delivers Web Push only to a web app that was ADDED TO THE
 * HOME SCREEN and opened from its icon. A Safari tab on the same phone has no
 * `PushManager` at all, so before this existed the panel said "this browser does
 * not support push" -- true, and a dead end: nothing told the person what would
 * make it work.
 *
 * ## Capability first, user agent only for the wording
 *
 * Whether push CAN work is decided by feature detection (`serviceWorker`,
 * `PushManager`, `Notification`), never by the UA string. The UA is consulted
 * for exactly one thing -- choosing between "install it" and "this browser
 * cannot do it" -- because both look identical to capability detection (push is
 * absent) yet need opposite advice. iPadOS 13+ reports a desktop-Safari UA, so
 * it is recognised by `MacIntel` + multi-touch, the standard tell.
 *
 * No claim is made that a Safari tab can receive background push on iOS: it
 * cannot, and the copy says so.
 *
 * Pure -- the platform is injected -- so the decision table is testable without
 * a browser, which this repo does not have in its unit runner.
 */

export type PushGuidanceState =
  /** Push API present, permission still askable (or already granted). */
  | "ready"
  /** Push API present but the person refused; the browser will not ask again. */
  | "denied"
  /** iOS/iPadOS in a normal browser tab: install to the Home Screen first. */
  | "ios-install"
  /** iOS/iPadOS installed app, but no push API: the OS is older than 16.4. */
  | "ios-update"
  /** Everything else without push (old browser, insecure context, webview). */
  | "unsupported";

export interface PushEnvironment {
  isIos: boolean;
  /** Running as an installed web app (Home Screen), not in a browser tab. */
  standalone: boolean;
  /** `serviceWorker` + `PushManager` + `Notification` all present. */
  pushSupported: boolean;
  permission: "default" | "granted" | "denied" | "unavailable";
}

/** The slice of `window`/`navigator` this module reads. */
export interface PushEnvironmentSource {
  navigator?: {
    userAgent?: string;
    platform?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
    serviceWorker?: unknown;
  };
  matchMedia?: (query: string) => { matches: boolean };
  PushManager?: unknown;
  Notification?: { permission?: string };
}

export function detectPushEnvironment(
  source: PushEnvironmentSource = globalThis as unknown as PushEnvironmentSource
): PushEnvironment {
  const nav = source.navigator ?? {};
  const userAgent = nav.userAgent ?? "";

  const isIos =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);

  // `navigator.standalone` is the iOS-only legacy flag; the media query is the
  // standard. Either is sufficient.
  const standalone =
    nav.standalone === true ||
    source.matchMedia?.("(display-mode: standalone)").matches === true;

  const pushSupported =
    nav.serviceWorker !== undefined &&
    source.PushManager !== undefined &&
    source.Notification !== undefined;

  const raw = source.Notification?.permission;
  const permission =
    raw === "default" || raw === "granted" || raw === "denied"
      ? raw
      : "unavailable";

  return { isIos, standalone, pushSupported, permission };
}

export function classifyPushGuidance(env: PushEnvironment): PushGuidanceState {
  if (env.pushSupported) {
    return env.permission === "denied" ? "denied" : "ready";
  }

  if (env.isIos) {
    return env.standalone ? "ios-update" : "ios-install";
  }

  return "unsupported";
}
