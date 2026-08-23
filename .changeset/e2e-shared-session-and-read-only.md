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

### `tests/e2e/admin-read-only-access.e2e.ts`

The gap between "owner sees everything" and "nobody sees anything": a user granted every tenant read and no writes. Every gated screen must render for them — a screen that denies is demanding more than its `authorize` block declares, and one that throws renders fine for an owner and breaks for everyone else.

The first version asserted "every screen renders" and reported `/admin/tenants` and `/admin/partner-registry` as defects. **They were not** — both authorize on PLATFORM-scoped permissions, and denying a tenant-scoped operator is exactly right. Checking before reporting turned a wrong assertion into a better one: the expectation is now derived from each screen's authorize scope against the live catalogue, so the test also exercises ADR-0053's tenant/platform boundary at runtime for the first time.

Its limits are stated in the file rather than implied: it verifies **consistency** between declared scope and behaviour, not that the right screens are platform-scoped — proven by a mutation that downgraded `/admin/tenants` and correctly, uselessly, passed. The mutation that does belong to it — granting the read-only role the two platform reads — turns it red naming both screens.

### The hydration window, documented not closed

`ADMIN_DELEGATION_READY_ATTRIBUTE` marks the document once a delegated listener is attached, and `admin-users.e2e.ts` waits for it and then for the response itself. Closing the window properly would mean gating 76 controls that share no selector convention, which risks disabling things that work without JavaScript. Making it observable is the honest half.
