---
"awcms": patch
---

fix(db): a blank `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` shadowed the `DATABASE_URL` fallback it claims to have

`getNamedDatabaseClient` resolved its connection string as

```ts
process.env[envVarName] ?? process.env.DATABASE_URL
```

and `??` falls back only on `null`/`undefined`. A **blank** value is therefore
"configured": the fallback never runs, and the operator gets

```
WORKER_DATABASE_URL (or DATABASE_URL as a fallback) is required to connect to the database.
```

with `DATABASE_URL` set and correct. An error that names the fallback it has
just refused to use, which is close to the worst possible message — it sends the
reader to check the variable that is already right.

The per-kind URLs are documented as **opt-in**: unset means fall back to
`DATABASE_URL` so a deployment managing one connection string keeps working.
Blank is what an operator produces when trying to express exactly that, and it
did the opposite.

A blank value is not an exotic input:

- a compose file with `WORKER_DATABASE_URL:` and nothing after it;
- a PaaS environment row saved empty (Coolify, and this deployment uses one);
- `export A=1 B=$A` — `$A` is expanded before `A` is assigned, so `B` is blank.

None of those look like "unset" to whoever wrote them, which is why the failure
reads as a contradiction rather than as a hint.

`readConfiguredUrl` now treats blank and whitespace-only as unset, so the
fallback behaves the way the error message and the module header both already
claimed. Trimming matters for the same reason: a variable holding only spaces
otherwise reaches `new Bun.SQL(" ")` and fails somewhere far from its cause.

Found while running the integration suite locally — seven of the "nine
pre-existing failures" reported earlier in this work were this, triggered by the
`export A=1 B=$A` form. They were never repo failures. With the environment set
correctly the suite is **565 pass, 0 fail**.
