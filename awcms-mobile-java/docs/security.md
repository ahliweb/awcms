# Security Guidelines

## Storage
- Store access/refresh tokens in `EncryptedSharedPreferences` or Keystore.
- Do not store service role keys on device.
- Clear tokens on logout or token revocation.

## Transport
- Enforce HTTPS only (`usesCleartextTraffic=false`).
- Consider certificate pinning for production.
- Use timeouts and retry policies to avoid leaking retries.

## Auth and RLS
- Always use user access tokens for API calls.
- Rely on Supabase RLS to enforce tenant boundaries.
- Use Edge Functions for privileged workflows.

## Permissions
- Request runtime permissions only when needed.
- Avoid broad permissions (location, storage) unless required.

## OWASP Mobile Basics
- Obfuscate release builds with R8/ProGuard.
- Disable logging of secrets in production.
- Detect tampering/rooted devices if required by policy.
- Use secure random for IDs and tokens.
