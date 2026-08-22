---
"awcms": patch
---

fix(security): a tenant SSO admin could name ANY environment variable as the OIDC client secret

`client_secret_env_var` was validated as "a non-empty string". A tenant SSO
administrator could therefore write `DATABASE_URL` — or
`AUTH_MFA_SECRET_ENCRYPTION_KEY`, or `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY`, the
key that decrypts every other provider's stored secret — point `issuer_url` at a
host they control, and receive that value in the `client_secret` field of the
token-exchange POST. Before any ID token is validated, and with the SSRF guard
satisfied, because the host really is reachable.

Nothing was broken. Every component did exactly what it was written to do; the
COMPOSITION was a tenant-admin → deployment-compromise primitive. It is not live
(`AUTH_SSO_ENABLED` is off in production), which is exactly why it is cheap to
close now and expensive to close the day SSO is switched on.

The name a provider may give is now bounded to
`^AUTH_SSO_CLIENT_SECRET_[A-Z0-9_]{1,48}$`. A **namespace** rather than a
deny-list, because a deny-list is a list somebody has to keep in step with every
secret this deployment or a future one happens to hold, and it fails open for the
one added last week. A namespace fails the other way: a variable an operator has
not deliberately created under this prefix cannot be named at all. Note what the
prefix does not match — `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY` is one
underscore-separated word away, and is excluded.

**Checked in three places, and only the third is load-bearing.** Both admin
validators refuse a bad name at write time — create AND update, because a
create-only check is one an admin walks around by patching afterwards. Then
`resolveProviderClientSecret` re-asserts it immediately before it touches `env`.
That last one is what matters: validators only see values arriving now, and the
reader reads rows written in the past by writers that predate the rule. A gate on
the front door does nothing about what is already inside.

The refusal is `null`, which the caller already treats as a misconfigured
provider. Deliberately no distinct error code — the only person who can act on it
is an operator reading the provider row, and a distinct code would tell a caller
which environment variables this deployment does and does not hold.

No variable of this shape exists by default; `.env.example` and the env reference
say how to create one per provider.
