---
"awcms": patch
---

Fix the purge transport: Bun cannot send the `BAN` method, so no purge ever
reached Varnish.

`sendEdgeCachePurge` issued `fetch(endpoint, { method: "BAN" })`, the
conventional Varnish idiom. **Bun does not transmit non-standard HTTP methods.**
Both `fetch` and `node:http` deliver that request as `GET` — confirmed against
Bun 1.3.14 with `varnishlog -i ReqMethod`, where the same request written
byte-for-byte over a raw socket logs `BAN` and answers `200 Banned`.

Every purge therefore fell past the VCL's ban branch to the origin, which 404s an
unrouted path. On a Bun-only runtime (ADR-0002) no configuration makes the `BAN`
method work.

The wire protocol is now `POST /__edge-cache-purge`. The security model is
unchanged — the method was never a control; the purge ACL, the shared token, and
the key-charset re-validation at the edge all still apply, to both entry points.
The VCL continues to accept a real `BAN`, so `curl -X BAN` remains available for
operator debugging.

Adds `tests/edge-cache-purge-client.test.ts`, the first tests this client has had.
They run against a real `Bun.serve` and assert `request.method` **as received**,
because that is the only formulation that can fail for the reason this failed: an
injected `fetchImpl` observes the argument, not the wire, and would have asserted
`method === "BAN"` and passed forever.
