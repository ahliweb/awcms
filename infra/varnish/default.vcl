vcl 4.1;

# AWCMS edge cache — ADR-0042.
#
# ## The one thing to understand about this file
#
# It is DEFAULT-DENY. Varnish's built-in VCL caches a 200 that carries no cache
# directives for `default_ttl` (120s out of the box). In front of a multi-tenant
# application that behaviour is a cross-tenant disclosure waiting to happen: one
# admin page cached under a URL and every later visitor gets someone else's data.
#
# So `vcl_backend_response` below caches ONLY responses the origin explicitly
# tagged with `Surrogate-Control`. Everything else — including anything new that
# gets added to the app tomorrow and forgets about caching — is passed straight
# through. Forgetting is safe; caching requires a deliberate act on both sides.
#
# The application performs the same check independently (`cacheability.ts`).
# Two mechanisms, because one of them being wrong is a disclosure rather than a
# performance regression.

import std;

backend default {
    .host = "app";
    .port = "4321";
    # A backend Varnish believes is healthy while it is not turns every request
    # into a 503. Cheap probe, generous threshold.
    .probe = {
        .url = "/api/v1/health";
        .timeout = 2s;
        .interval = 5s;
        .window = 5;
        .threshold = 3;
    }
}

# Only these may issue a BAN. The token check below is the real authentication;
# this ACL is defence in depth so a leaked token is not, by itself, enough from
# the public internet.
acl purge_clients {
    "localhost";
    "127.0.0.1";
    "::1";
    "10.0.0.0"/8;
    "172.16.0.0"/12;
    "192.168.0.0"/16;
}

sub vcl_recv {
    # ---------------------------------------------------------------------
    # Invalidation
    # ---------------------------------------------------------------------
    if (req.method == "BAN") {
        if (!client.ip ~ purge_clients) {
            return (synth(403, "Not allowed"));
        }

        # `std.getenv` keeps the shared secret out of this file and out of the
        # image. Empty env => no BAN is ever accepted, which fails closed.
        if (std.getenv("EDGE_CACHE_PURGE_TOKEN") == ""
            || req.http.X-Edge-Purge-Token != std.getenv("EDGE_CACHE_PURGE_TOKEN")) {
            return (synth(403, "Bad purge token"));
        }

        # The key is interpolated into a REGEX below. This charset check is what
        # stops `.*` (or any other metacharacter) turning one invalidation into
        # "flush everything" — a single-request denial of service against the
        # origin. The application sanitizes too; this is the independent check.
        if (req.http.X-Edge-Purge-Key !~ "^[A-Za-z0-9:._-]{1,512}$") {
            return (synth(400, "Bad purge key"));
        }

        # `(^| )` / `( |$)` anchor the match to a whole space-separated token, so
        # banning tenant `t:abc` cannot also ban `t:abcdef` — a different tenant.
        ban("obj.http.Surrogate-Key ~ (^| )" + req.http.X-Edge-Purge-Key + "( |$)");

        return (synth(200, "Banned"));
    }

    # ---------------------------------------------------------------------
    # Never-cache surfaces
    # ---------------------------------------------------------------------
    if (req.url ~ "^/admin" || req.url ~ "^/api/") {
        return (pass);
    }

    if (req.method != "GET" && req.method != "HEAD") {
        return (pass);
    }

    if (req.http.Authorization) {
        return (pass);
    }

    # Any identity-bearing cookie means the response is per-principal. Matches
    # the `awcms_` prefix rule in `cacheability.ts` — keep the two in step.
    if (req.http.Cookie ~ "(^|;\s*)awcms_") {
        return (pass);
    }

    # Third-party cookies (analytics and the like) are same-origin noise that
    # would otherwise fragment the cache into one entry per visitor. They are not
    # identity for this application, so drop them from the lookup entirely.
    unset req.http.Cookie;

    return (hash);
}

sub vcl_hash {
    # Host is hashed by the built-in VCL already; this makes the multi-tenant
    # dependency explicit and survives someone overriding the builtin. Without
    # it, unlimited subdomains would collide on path alone — every tenant's
    # `/blog/x` sharing one cache entry.
    hash_data(req.http.host);
}

sub vcl_backend_response {
    # ---- DEFAULT DENY ----------------------------------------------------
    # No explicit surrogate instruction => the origin did not opt this response
    # in => do not cache it. This single branch is the load-bearing line in the
    # file.
    if (!beresp.http.Surrogate-Control) {
        set beresp.uncacheable = true;
        set beresp.ttl = 0s;

        return (deliver);
    }

    # A response that sets a cookie is per-visitor by construction. The origin
    # should never have tagged it; refuse anyway.
    if (beresp.http.Set-Cookie) {
        set beresp.uncacheable = true;
        set beresp.ttl = 0s;
        unset beresp.http.Surrogate-Control;

        return (deliver);
    }

    set beresp.ttl = std.duration(
        regsub(beresp.http.Surrogate-Control, "^.*max-age=([0-9]+).*$", "\1s"),
        0s
    );

    if (beresp.ttl <= 0s) {
        set beresp.uncacheable = true;

        return (deliver);
    }

    # Grace: keep serving a stale copy while one request revalidates in the
    # background. This is the single most effective protection against a
    # thundering herd hitting the database when a popular object expires — which
    # is the whole point of ADR-0042.
    set beresp.grace = std.duration(
        regsub(
            beresp.http.Surrogate-Control,
            "^.*stale-while-revalidate=([0-9]+).*$",
            "\1s"
        ),
        0s
    );

    # `Surrogate-Control` is for this cache and must not reach browsers or a
    # downstream CDN: the TTL varies with origin load (the auto-activation ramp),
    # and a load-dependent number baked into browser caches cannot be purged.
    unset beresp.http.Surrogate-Control;

    return (deliver);
}

sub vcl_deliver {
    # Surrogate keys are internal topology. Leaking them would tell a visitor
    # every tenant id a page belongs to and hand them the exact strings a purge
    # endpoint expects.
    unset resp.http.Surrogate-Key;

    # Debug-only breadcrumb from the origin; useful in logs, noise (and mild
    # information disclosure) in a browser.
    unset resp.http.X-Edge-Cache-Skip;

    if (obj.hits > 0) {
        set resp.http.X-Cache = "HIT";
    } else {
        set resp.http.X-Cache = "MISS";
    }
}
