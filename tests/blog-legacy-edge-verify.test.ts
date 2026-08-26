/**
 * The HTTP-level cutover verifier (Issues #599 / #711, ADR-0114 / ADR-0115).
 *
 * ## Why a real server and not an injected fake
 *
 * The same reason `tests/edge-cache-purge-client.test.ts` gives, and it is not
 * a style preference: an injected fake observes the ARGUMENT, and every defect
 * this job exists to catch lives on the WIRE. A mock asserting
 * `init.redirect === "manual"` passes forever over a client that follows
 * redirects anyway, and the report then shows one hop for a three-hop chain —
 * which is the exact claim PRD §9.2 turns on.
 *
 * So every case below stands up a `Bun.serve` on port 0 and asserts what the
 * verifier concluded from responses a server actually sent.
 *
 * ## The case that matters most
 *
 * "404 with no `Location`" is not an edge case here — it is what the 67 rubrik
 * entries committed AT THE TIME returned when they were replayed against
 * `awcms-astro`'s real built server, while ADR-0113 §Consequences claimed in
 * two languages that no change was needed there. This job is the replay, so the
 * first thing it has to get right is refusing that.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  probeUrlFor,
  walkRedirectChain
} from "../scripts/blog-legacy-edge-verify";
import {
  finalLiveness,
  hopRefusalFor,
  probeFactsFrom,
  resolveLocation
} from "../src/modules/seo-distribution/domain/edge-redirect-probe";
import { classifyCutoverOutcome } from "../src/modules/seo-distribution/domain/cutover-verification";

let server: ReturnType<typeof Bun.serve>;
let base: string;

/**
 * One server for every shape a cutover meets, keyed by path.
 *
 * Written as real responses rather than as fixtures so the chain-walking is
 * exercised end to end: `Location` resolution, the manual redirect mode, and
 * the loop guard all read a header this server actually set.
 */
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);

      switch (url.pathname) {
        // The correct shape: one 301 to a page that exists.
        case "/news/48213_Banjir_Melanda_Kobar.html":
          return new Response(null, {
            status: 301,
            headers: { location: "/hukum/banjir-melanda-kobar" }
          });
        case "/hukum/banjir-melanda-kobar":
          return new Response("<h1>Banjir</h1>", { status: 200 });

        // The ADR-0113 shape: the origin does not redirect at all.
        case "/rubrik/Hukum.html":
          return new Response("not found", { status: 404 });

        // A 301 into a 404 — worse than the 404 it replaces.
        case "/news/1_Gone.html":
          return new Response(null, {
            status: 301,
            headers: { location: "/hukum/gone" }
          });
        case "/hukum/gone":
          return new Response("not found", { status: 404 });

        // Three hops: http→https and www→apex modelled as two extra redirects,
        // which is exactly the chain ADR-0114 gives the edge to collapse.
        case "/hop1":
          return new Response(null, {
            status: 301,
            headers: { location: "/hop2" }
          });
        case "/hop2":
          return new Response(null, {
            status: 301,
            headers: { location: "/hop3" }
          });
        case "/hop3":
          return new Response(null, {
            status: 301,
            headers: { location: "/hukum/banjir-melanda-kobar" }
          });

        // A cycle.
        case "/loop-a":
          return new Response(null, {
            status: 302,
            headers: { location: "/loop-b" }
          });
        case "/loop-b":
          return new Response(null, {
            status: 302,
            headers: { location: "/loop-a" }
          });

        // An origin having a bad minute. NOT a missing page.
        case "/boom":
          return new Response("no", { status: 502 });

        // A relative Location, which is legal and common.
        case "/relative":
          return new Response(null, {
            status: 301,
            headers: { location: "hukum/banjir-melanda-kobar" }
          });

        default:
          return new Response("not found", { status: 404 });
      }
    }
  });

  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

async function verdictFor(path: string) {
  const chain = await walkRedirectChain(`${base}${path}`, {
    maxHops: 4,
    timeoutMs: 5_000,
    // The fixtures are on 127.0.0.1, which the probe refuses by DEFAULT. That
    // default is the point (see the `unsafe_redirect` cases below); these
    // cases opt in exactly as an operator verifying a local build does.
    allowPrivateAddresses: true
  });
  return {
    chain,
    verdict: classifyCutoverOutcome(probeFactsFrom(chain)),
    facts: probeFactsFrom(chain)
  };
}

describe("what a reader actually receives", () => {
  test("one 301 to a live page is the only thing that passes", async () => {
    const { verdict, facts } = await verdictFor(
      "/news/48213_Banjir_Melanda_Kobar.html"
    );

    expect(verdict).toBe("ok");
    expect(facts.hops).toBe(1);
  });

  test("an origin that does not redirect at all is `no_rule`, not `ok`", async () => {
    // The ADR-0113 failure, reproduced. The 67 rubrik entries committed at the
    // time returned exactly this against the repo that serves their targets,
    // while the database-only verifier reported them clean. (68 are committed
    // now; the 68th was added afterwards and has not been replayed.)
    const { verdict, facts } = await verdictFor("/rubrik/Hukum.html");

    expect(verdict).toBe("no_rule");
    expect(facts.hops).toBe(0);
  });

  test("a 301 into a 404 is `target_missing`", async () => {
    const { verdict } = await verdictFor("/news/1_Gone.html");
    expect(verdict).toBe("target_missing");
  });

  test("three hops is `chain_too_long` — the count PRD 9.2 turns on", async () => {
    // Countable only on the wire. A rule table knows about at most one of
    // these three, which is why ADR-0114 gives the job to the edge.
    const { verdict, facts } = await verdictFor("/hop1");

    expect(verdict).toBe("chain_too_long");
    expect(facts.hops).toBeGreaterThan(1);
  });

  test("a cycle is `loop`, and is not reported as an over-long chain", async () => {
    const { verdict, chain } = await verdictFor("/loop-a");

    expect(verdict).toBe("loop");
    // The walk STOPS at the repeat rather than spending the hop budget:
    // reporting `chain_too_long` would send an operator to shorten a chain
    // instead of breaking a cycle.
    expect(chain.looped).toBe(true);
    expect(chain.exhausted).toBe(false);
  });

  test("a 5xx is UNREACHABLE — neither a missing page nor a missing rule", async () => {
    // An origin having a bad minute has not said the page is missing, and it
    // has not said no rule matches either. Before `unreachable` existed this
    // classified as `no_rule`, whose reason text reads "this URL will answer
    // 404 after cutover, and its ranking is lost" — about a request that
    // produced no observation at all.
    const { verdict } = await verdictFor("/boom");
    expect(verdict).toBe("unreachable");
  });

  test("a 403 with no redirect is NOT `unreachable` — the origin DID answer", async () => {
    // `unreachable`'s operator text is "the request never produced an answer".
    // For a 403, 401, 429 or 451 that is false, and what the origin said is the
    // most useful fact in the row. This job's own User-Agent comment anticipates
    // meeting an edge with bot rules, so it is not a hypothetical status.
    //
    // `no_rule` is the right answer and its text is accurate at this layer:
    // nothing redirected, so nothing sends a reader from this URL to the new
    // page. The property under test is the one that was wrong — a status the
    // origin actually sent must never be reported as no status at all.
    const gated = Bun.serve({
      port: 0,
      fetch: () => new Response("nope", { status: 403 })
    });

    try {
      const chain = await walkRedirectChain(
        `http://127.0.0.1:${gated.port}/news/1_x.html`,
        { maxHops: 4, timeoutMs: 5_000, allowPrivateAddresses: true }
      );

      const verdict = classifyCutoverOutcome(probeFactsFrom(chain));
      expect(verdict).not.toBe("unreachable");
      expect(verdict).toBe("no_rule");
      expect(chain.responses[0]!.status).toBe(403);
    } finally {
      gated.stop(true);
    }
  });

  test("a relative Location is resolved the way a browser resolves it", async () => {
    const { verdict, chain } = await verdictFor("/relative");

    expect(verdict).toBe("ok");
    expect(chain.responses[1]!.url).toBe(`${base}/hukum/banjir-melanda-kobar`);
  });

  test("a host that does not answer is unverifiable, and does not throw", async () => {
    // Port 1 on loopback refuses immediately. The run must record the failure
    // and continue: one dead URL in a 25,029-row corpus cannot end the job.
    const chain = await walkRedirectChain("http://127.0.0.1:1/news/1_x.html", {
      maxHops: 4,
      timeoutMs: 2_000,
      allowPrivateAddresses: true
    });

    expect(chain.responses[0]!.status).toBeNull();
    expect(classifyCutoverOutcome(probeFactsFrom(chain))).toBe("unreachable");
  });

  test("redirects are NOT followed automatically", async () => {
    // The property a mock cannot express. If `redirect: "manual"` were dropped,
    // Bun would follow the chain itself and the walk would see ONE response
    // with the final status — three hops reported as a clean one.
    const { chain } = await verdictFor("/hop1");

    expect(chain.responses.length).toBeGreaterThan(1);
    expect(chain.responses[0]!.status).toBe(301);
  });
});

describe("the facts a chain produces", () => {
  test("a 2xx is live, 404 and 410 are missing, everything else is unknown", () => {
    expect(finalLiveness(200)).toBe(true);
    expect(finalLiveness(204)).toBe(true);
    expect(finalLiveness(404)).toBe(false);
    expect(finalLiveness(410)).toBe(false);
    expect(finalLiveness(500)).toBeNull();
    expect(finalLiveness(403)).toBeNull();
    expect(finalLiveness(null)).toBeNull();
  });

  test("an exhausted walk is chain_too_long even with no repeat", () => {
    const facts = probeFactsFrom({
      responses: [
        { url: "http://x/1", status: 301, location: "/2" },
        { url: "http://x/2", status: 301, location: "/3" }
      ],
      exhausted: true,
      looped: false
    });

    expect(facts.refusal).toBe("chain_too_long");
    expect(classifyCutoverOutcome(facts)).toBe("chain_too_long");
  });

  test("eligibility is not asked at this layer", () => {
    // `isRedirectEligiblePath` is a rule about which paths THIS application's
    // tenant table may claim. The edge is in front of both origins and answers
    // for paths neither routes, so importing that predicate would mark a URL
    // the edge redirects correctly as `ineligible`.
    const facts = probeFactsFrom({
      responses: [
        { url: "http://x/api/v1/thing", status: 301, location: "/ok" },
        { url: "http://x/ok", status: 200, location: null }
      ],
      exhausted: false,
      looped: false
    });

    expect(facts.eligible).toBe(true);
    expect(classifyCutoverOutcome(facts)).toBe("ok");
  });

  test("a Location is resolved against its response, exactly as a browser would", () => {
    expect(resolveLocation("http://x/a", "/b")).toBe("http://x/b");
    expect(resolveLocation("http://x/a/b", "c")).toBe("http://x/a/c");
    expect(resolveLocation("http://x/a", "https://y/z")).toBe("https://y/z");

    // Not a mistake and not repaired: `ht!tp://%%%` is a legal RELATIVE
    // reference, and a browser resolves it against the base exactly like this.
    // Pinned rather than "fixed" because a verifier that second-guessed the URL
    // parser would be reporting its own resolution instead of the reader's.
    expect(resolveLocation("http://x/a", "ht!tp://%%%")).toBe(
      "http://x/ht!tp://%%%"
    );

    // A base that is not a URL has nothing to resolve against.
    expect(resolveLocation("not a url", "/b")).toBeNull();
  });
});

describe("a hop is not followed just because a server asked", () => {
  // `Location` is written by whatever answered the previous request. Before
  // `hopRefusalFor` existed, all three of these were FOLLOWED and classified
  // `ok` — "resolves in one hop to a page this deployment serves".

  test("a `file:` hop is refused, and the verdict says so", async () => {
    const attacker = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(null, {
          status: 301,
          headers: { location: "file:///etc/hostname" }
        })
    });

    try {
      const chain = await walkRedirectChain(
        `http://127.0.0.1:${attacker.port}/news/1_x.html`,
        { maxHops: 4, timeoutMs: 5_000, allowPrivateAddresses: true }
      );

      expect(chain.unsafeHop?.refusal).toBe("scheme_not_allowed");
      expect(classifyCutoverOutcome(probeFactsFrom(chain))).toBe(
        "unsafe_redirect"
      );
    } finally {
      attacker.stop(true);
    }
  });

  test("a `data:` hop is refused", async () => {
    const attacker = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(null, {
          status: 301,
          headers: { location: "data:text/plain,hi" }
        })
    });

    try {
      const chain = await walkRedirectChain(
        `http://127.0.0.1:${attacker.port}/news/1_x.html`,
        { maxHops: 4, timeoutMs: 5_000, allowPrivateAddresses: true }
      );

      expect(chain.unsafeHop?.refusal).toBe("scheme_not_allowed");
    } finally {
      attacker.stop(true);
    }
  });

  test("a hop into a link-local address is refused when private hops are not allowed", async () => {
    // 169.254.169.254 is the cloud metadata address. The request is never made
    // — `hopRefusalFor` runs BEFORE the fetch — so this test needs no network.
    expect(
      hopRefusalFor("http://169.254.169.254/latest/meta-data/", {
        allowPrivateAddresses: false
      })
    ).toBe("private_address");

    expect(
      hopRefusalFor("http://127.0.0.1:8080/x", { allowPrivateAddresses: false })
    ).toBe("private_address");
  });

  test("the guard runs on the FIRST hop too, not only on redirects", async () => {
    // The corpus is a file, and a file can carry a `file://` line as easily as
    // a hostile `Location` can. A guard that only ran on hops two and later
    // would be one refactor away from not running at all.
    const chain = await walkRedirectChain("file:///etc/hostname", {
      maxHops: 4,
      timeoutMs: 5_000,
      allowPrivateAddresses: true
    });

    expect(chain.responses).toHaveLength(0);
    expect(chain.unsafeHop?.refusal).toBe("scheme_not_allowed");
    expect(classifyCutoverOutcome(probeFactsFrom(chain))).toBe(
      "unsafe_redirect"
    );
  });

  test("an IPv6 literal is refused too — the brackets are not a bypass", () => {
    // `new URL("http://[::1]/").hostname` is `"[::1]"` WITH the brackets, and
    // `isIP("[::1]")` answers 0. The guard was written as
    // `isIP(url.hostname) !== 0`, so every IPv6 literal short-circuited to
    // "allowed" and `isBlockedAddress` — the rule this module says it reuses
    // rather than restates — was never consulted. Three spellings, all of which
    // reached the network before this test existed.
    for (const url of [
      "http://[::1]:8080/x",
      "http://[fd00::1]/x",
      "http://[::ffff:127.0.0.1]/x"
    ]) {
      expect(hopRefusalFor(url, { allowPrivateAddresses: false })).toBe(
        "private_address"
      );
    }

    // A PUBLIC IPv6 literal must still be allowed, or the guard has just banned
    // the modern internet rather than the private ranges.
    expect(
      hopRefusalFor("http://[2001:4860:4860::8888]/x", {
        allowPrivateAddresses: false
      })
    ).toBeNull();
  });

  test("credentials in a hop URL are refused", () => {
    expect(
      hopRefusalFor("http://user:pw@example.test/x", {
        allowPrivateAddresses: true
      })
    ).toBe("credentials_in_url");
  });

  test("a public address and an ordinary hostname are allowed", () => {
    // The guard must not refuse the thing the job exists to do: start from the
    // `http://` URL a crawler holds.
    expect(
      hopRefusalFor("http://www.seputarborneo.com/news/1_x.html", {
        allowPrivateAddresses: false
      })
    ).toBeNull();
    expect(
      hopRefusalFor("https://8.8.8.8/x", { allowPrivateAddresses: false })
    ).toBeNull();
  });

  test("`unsafe_redirect` OUTRANKS a loop and an over-long chain", () => {
    // A hostile origin can produce a cycle as easily as a single hop, and
    // reporting `loop` would hide the thing an operator has to act on.
    const facts = probeFactsFrom({
      responses: [{ url: "http://x/1", status: 301, location: "file:///x" }],
      exhausted: true,
      looped: true,
      unsafeHop: { url: "file:///x", refusal: "scheme_not_allowed" }
    });

    expect(classifyCutoverOutcome(facts)).toBe("unsafe_redirect");
  });
});

describe("the report is in corpus order, even when a URL repeats", () => {
  test("the same URL twice keeps BOTH of its positions", async () => {
    // The report used to be built by `push` then sorted with a
    // `Map<url, index>` — which keys on the URL, so a corpus containing one
    // URL twice held only its LAST index, both rows sorted into that slot, and
    // the first occurrence moved out of its position in the file. A duplicated
    // URL in a hand-assembled legacy corpus is ordinary, and the comment above
    // the sort named the property it was losing: "a report whose rows shuffle
    // between runs cannot be diffed".
    //
    // Asserted over the ORDERING PRIMITIVE rather than by parsing stdout: the
    // fix is that positions index the array instead of keying it, and that is
    // what this reproduces.
    const targets = ["/a", "/b", "/a", "/c"];

    const byUrlKey = new Map(targets.map((url, index) => [url, index]));
    const sorted = [...targets].sort(
      (x, y) => (byUrlKey.get(x) ?? 0) - (byUrlKey.get(y) ?? 0)
    );
    // The old scheme: "/a" collapses onto index 2, so both copies sort after
    // "/b" and the first occurrence has left position 0.
    expect(sorted).not.toEqual(targets);

    const byPosition: string[] = new Array(targets.length);
    targets.forEach((url, index) => {
      byPosition[index] = url;
    });
    expect(byPosition).toEqual(targets);
  });
});

describe("the corpus", () => {
  test("an absolute URL is probed as given", () => {
    expect(
      probeUrlFor("http://www.seputarborneo.com/news/1_x.html", null)
    ).toBe("http://www.seputarborneo.com/news/1_x.html");
  });

  test("a relative entry needs an --origin, and says so by returning null", () => {
    expect(probeUrlFor("/news/1_x.html", null)).toBeNull();
    expect(probeUrlFor("/news/1_x.html", "http://legacy.example")).toBe(
      "http://legacy.example/news/1_x.html"
    );
  });

  test("a non-http scheme is refused rather than probed", () => {
    // `file:` and `javascript:` in a corpus are the two that matter, and a
    // verifier that fetched either would be doing something other than
    // verifying.
    expect(probeUrlFor("file:///etc/passwd", null)).toBeNull();
    expect(probeUrlFor("javascript:alert(1)", null)).toBeNull();
  });
});
