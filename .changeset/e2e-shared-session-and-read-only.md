---
"awcms": minor
---

test(e2e): the intermittent suite failure was eleven parallel argon2id verifications, not a race

`admin-users.e2e.ts` went flaky in CI, and the first diagnosis here was wrong. It looked like a hydration race — delegated admin listeners bind on `document` inside a deferred module, so a click before that is silently swallowed. That window is real and is now documented, but it was **not** the cause.

The cause: **every authenticated spec drove the real `/login` form itself.** With `fullyParallel: true` that meant up to five simultaneous `Bun.password.verify` calls — argon2id on Bun's defaults, memory- and CPU-hard by design — while the same server rendered admin pages.

The suite was bimodal: usually ~15s and green, occasionally **four minutes with six or seven failures**, every one a 30s `waitForURL` timeout **at the login step**, in specs with nothing to do with each other. It reproduced with the screen-sweep specs removed, so it predates them, and `--workers=1` made it vanish. CI hid it behind `retries: 1` — which is exactly why it surfaced as one "flaky" line rather than as a problem.

Nothing about argon2's cost is wrong; that cost is the control. What was wrong was paying it eleven times to test things that are not authentication.

### A setup project logs in once

`tests/e2e/auth.setup.ts` authenticates the owner and saves `storageState`; the `chromium` project depends on it and reuses the session. Three specs opt out with a fresh state: `login.e2e.ts`, because the login flow is its subject, and the two that authenticate as somebody other than the owner. **Thirteen logins became four.**

Six consecutive runs at ~18s with zero variance, against the previous 15s-or-four-minutes.

### A read-only sweep is NOT in this change, and why

A spec for the user between "owner sees everything" and "nobody sees anything" was written and works — but it proved flaky for a reason that is not its own, and shipping a known-flaky test right after diagnosing one would be incoherent.

`admin-modules-toggle.e2e.ts` deliberately DISABLES the `reporting` module, and `/admin` authorizes on `reporting.dashboard.read`. A read-only sweep overlapping that toggle sees the dashboard deny — correctly. Alone it passed 4/4; in the suite it failed roughly one run in three, always on `/admin`.

That is a harness problem worth solving properly: read sweeps must not run concurrently with specs that mutate tenant-wide state. The `read` grant stays in `e2e-restricted-user.ts` for that work, with the reason recorded beside it.

Worth noting the two sweeps already on `main` are accidentally immune rather than correct: the render sweep asserts only `200`, and a denied screen still returns `200`; the deny sweep expects denial, which a disabled module also produces.

### The hydration window, documented not closed

`ADMIN_DELEGATION_READY_ATTRIBUTE` marks the document once a delegated listener is attached, and `admin-users.e2e.ts` waits for it and then for the response itself. Closing the window properly would mean gating 76 controls that share no selector convention, which risks disabling things that work without JavaScript. Making it observable is the honest half.
