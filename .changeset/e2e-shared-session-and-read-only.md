---
"awcms": minor
---

test(e2e): two different intermittent failures, and the CI one was shared tenant state

`admin-users.e2e.ts` went flaky in CI. This change fixes it — and the diagnosis took three attempts, two of which were wrong. Both wrong turns are recorded because each was confidently argued and each would have shipped a false explanation.

### What the CI flake actually was

The test asserts that re-assigning the role the owner already holds is rejected with `409`. It intermittently got **`200`** — the assignment succeeded.

The assign dropdown lists *every role in the tenant*, and `admin-roles.e2e.ts` creates one, concurrently. When it had, the dropdown's default was a role the owner did **not** hold, so the assign legitimately succeeded. Nothing about the page was wrong; the test depended on tenant state another spec mutates.

It now selects the `owner` role explicitly. Shared-state dependence, not a race.

### Wrong turn 1: a hydration race

Delegated admin listeners bind on `document` inside a deferred module, so a click before that is silently swallowed. That window is **real** and is now observable via `ADMIN_DELEGATION_READY_ATTRIBUTE` — but it was not the cause of anything here.

### Wrong turn 2: argon2 contention — real, but a different failure

Locally the suite was bimodal: usually ~15s green, occasionally **four minutes with six or seven failures**, every one a 30s `waitForURL` timeout **at the login step**. Every authenticated spec drove the real `/login` form, so five parallel workers meant five simultaneous `Bun.password.verify` calls — argon2id, memory- and CPU-hard by design — while the same server rendered admin pages. `--workers=1` made it vanish.

That is a genuine finding and the fix below is worth keeping. **But CI runs 2 workers, not 5, and never showed those login timeouts.** It was a local phenomenon, and treating it as the CI flake's cause was wrong.

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
