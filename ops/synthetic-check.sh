#!/usr/bin/env bash
# AWCMS synthetic production check — probe the live site the way a visitor does,
# and say something when it is wrong.
#
# WHY THIS EXISTS, IN ONE SENTENCE
#
# The language switcher answered 403 to EVERY user for hours, and nothing told
# anyone; it was found because someone happened to `curl` a surface they had just
# shipped.
#
# WHAT IT CHECKS, AND WHY THESE
#
# Not "is the box up" — the container healthcheck already answers that, and it
# answers it from INSIDE, where every defect this project has actually shipped was
# invisible. Each probe below is a defect that reached production and that no gate
# saw:
#
#   1. health          — the baseline. If this is red nothing else matters.
#   2. login renders   — SSR + DB + session config, in one 200.
#   3. CSP present     — the header exists and still carries exactly one hash.
#   4. no stray inline script — the class that made the theme toggle and the
#      language switcher inert. Served HTML, not the build.
#   5. feed is https   — the origin defect. `url.origin` was `http` behind TLS
#      termination and it LEAKED into every feed entry. Cloudflare rewrites
#      `href` attributes but not element text, so this probe sees the truth.
#   6. blog index 200  — one real content route end to end.
#
# Probes 4 and 5 are the point. They are cheap, they are specific, and each
# corresponds to an outage that lasted until a human went looking.
#
# ALERT DISCIPLINE
#
# A check that alerts every five minutes forever is a check people mute. State is
# kept in a file: the FIRST failure alerts, repeats stay quiet, and RECOVERY
# alerts once. Exit code always reflects the current run, so the log stays the
# record even when no message is sent.
#
# Install:
#   scp ops/synthetic-check.sh dinkes-prod:/home/admin1/awcms-jobs/ && chmod +x
#   crontab:  */10 * * * * /usr/bin/flock -n … synthetic-check.sh >> …/synthetic.log 2>&1
set -uo pipefail

BASE="${AWCMS_BASE_URL:-https://awcms.ahlikoding.com}"
TENANT="${AWCMS_PROBE_TENANT:-ahliweb}"
STATE="${AWCMS_SYNTHETIC_STATE:-/home/admin1/awcms-jobs/.synthetic-state}"
# The one CSP hash this app is allowed to carry — the theme-init script body.
THEME_HASH="${AWCMS_THEME_HASH:-sha256-lOc2GAiS/8scFxSOam/Qp0WAZJ9iWtVPpAe0h4d3eDE=}"
CURL="curl -sS --max-time 20"

NOTIFY_LIB="${HOME}/hermes/notify-telegram.sh"
if [ -r "$NOTIFY_LIB" ]; then . "$NOTIFY_LIB"; else notify_telegram() { return 1; }; fi

FAILURES=()
log() { echo "$(date -Is) synthetic: $*"; }
fail() { FAILURES+=("$1"); log "FAIL $1"; }
ok() { log "ok   $1"; }

# --- 1. health ---------------------------------------------------------------
CODE=$($CURL -o /dev/null -w '%{http_code}' "${BASE}/api/v1/health" || echo 000)
[ "$CODE" = "200" ] && ok "health 200" || fail "health returned ${CODE}"

# --- 1b. READINESS, which is a different question ----------------------------
#
# Finding D10: `/api/v1/database/pool/health` reports `databaseReachable` and
# `circuitBreakerState`, is equally unauthenticated, and until now was consulted
# by NOTHING. Coolify, the Docker HEALTHCHECK and the Varnish probe all read
# `/api/v1/health`, which is dependency-free ON PURPOSE — it answers "is this
# process alive", and it answers `200` with the database on fire.
#
# Those three are right to use liveness: restarting an app does not repair a
# database, and a probe that restarts containers during a database outage turns
# one incident into two. What was missing is a reader for the OTHER question,
# and this is the file whose job is exactly that — the header above says so:
# "not 'is the box up' — the container healthcheck already answers that, and it
# answers it from INSIDE, where every defect this project has actually shipped
# was invisible."
#
# Matched as JSON text rather than through `jq`, which the rest of this script
# does not require and the host may not have.
READY=$($CURL "${BASE}/api/v1/database/pool/health" || echo "")
if [ -z "$READY" ]; then
  fail "readiness endpoint returned nothing — the process is not answering at all"
else
  case "$READY" in
    *'"databaseReachable":true'*) ok "database reachable from the app" ;;
    *) fail "app is up but reports databaseReachable=false — it can serve no content" ;;
  esac
  case "$READY" in
    *'"circuitBreakerState":"open"'*)
      fail "database circuit breaker is OPEN — the app is refusing its own queries" ;;
    *) ok "database circuit breaker not open" ;;
  esac
fi

# --- 2 & 3 & 4. the login page, its CSP, and its scripts ---------------------
HEADERS=$(mktemp); BODY=$(mktemp)
trap 'rm -f "$HEADERS" "$BODY"' EXIT
CODE=$($CURL -o "$BODY" -D "$HEADERS" -w '%{http_code}' "${BASE}/login" || echo 000)

if [ "$CODE" = "200" ]; then
  ok "login 200"
  grep -qi 'name="password"' "$BODY" \
    && ok "login form renders" \
    || fail "login returned 200 but has no password field — SSR or DB problem behind a 200"
else
  fail "login returned ${CODE}"
fi

CSP=$(grep -i '^content-security-policy:' "$HEADERS" | tr -d '\r')
if [ -n "$CSP" ]; then
  ok "CSP header present"
  case "$CSP" in
    *"$THEME_HASH"*) ok "CSP carries the theme-init hash" ;;
    *) fail "CSP no longer carries the theme-init hash — the no-flash script is blocked" ;;
  esac
  case "$CSP" in
    *unsafe-inline*) fail "CSP contains 'unsafe-inline' — the single-owner policy was widened" ;;
  esac
else
  fail "no Content-Security-Policy header on /login"
fi

# An inline `<script>` (no src=) that is NOT the hash-authorised theme-init body
# is a script the browser refuses. This is the class that made the theme toggle
# and the language switcher render-but-inert.
INLINE=$(grep -o '<script[^>]*>' "$BODY" | grep -vc 'src=' || true)
if [ "${INLINE:-0}" -le 1 ]; then
  ok "inline scripts within bound (${INLINE:-0})"
else
  fail "${INLINE} inline <script> blocks on /login — CSP allows one; the extras are dead"
fi

# --- 5. the feed's absolute URLs ---------------------------------------------
FEED=$($CURL "${BASE}/blog/${TENANT}/feed.xml" || echo "")
if [ -z "$FEED" ]; then
  fail "feed /blog/${TENANT}/feed.xml returned nothing"
else
  # Element TEXT, which Cloudflare's HTTPS rewrites do not touch — so this sees
  # what the origin actually emitted.
  BAD=$(printf '%s' "$FEED" | grep -o '<link>http://[^<]*' | head -3 || true)
  if [ -n "$BAD" ]; then
    fail "feed emits http:// links on an https:// site — site-origin regression: ${BAD}"
  else
    ok "feed links are https"
  fi
fi

# --- 6. a real content route, FOLLOWED to where it actually serves ------------
#
# This probe asserted `200` on the bare URL and went red the day ADR-0098 landed,
# because the bare URL is an ALIAS: it answers `307` to `/{locale}/blog/{tenant}`
# by design. Left alone it would have alerted once and then sat "failing"
# forever — the muted-check failure its own §ALERT DISCIPLINE warns about.
#
# Worse, it would have been red for the WRONG reason while the real defect hid
# behind it. v10.0.0 shipped that redirect pointing at a 404: the hop was
# healthy and the destination was not, and each half looked fine when probed
# alone. So the assertion is the PAIR — follow the redirect, and require both
# that the destination serves and that it is the locale-prefixed spelling.
# `-L` plus `%{url_effective}` is what makes the second half observable.
CODE=$($CURL -L -o /dev/null -w '%{http_code}' "${BASE}/blog/${TENANT}" || echo 000)
FINAL=$($CURL -L -o /dev/null -w '%{url_effective}' "${BASE}/blog/${TENANT}" || echo "")

if [ "$CODE" != "200" ]; then
  fail "blog index returned ${CODE} after following redirects (final: ${FINAL:-none})"
elif ! printf '%s' "$FINAL" | grep -qE "/(en|id)/blog/${TENANT}([/?#]|$)"; then
  # A `200` on a bare URL means the locale prefix silently stopped being
  # canonical — the reader is being served an alias, and every cache entry and
  # every `hreflang` this site publishes now disagrees with what it serves.
  fail "blog index served an UNPREFIXED URL (${FINAL}) — ADR-0098 regression"
else
  ok "blog index 200 at its locale-prefixed URL (${FINAL})"
fi

# --- verdict + alert discipline ----------------------------------------------
PREV=""; [ -f "$STATE" ] && PREV=$(cat "$STATE")

if [ ${#FAILURES[@]} -gt 0 ]; then
  SUMMARY=$(printf '%s; ' "${FAILURES[@]}")
  log "VERDICT: ${#FAILURES[@]} failure(s)"
  if [ "$PREV" != "failing" ]; then
    notify_telegram "🔴 AWCMS synthetic check failing" "$BASE
${SUMMARY}" || log "notification failed (log remains the record)"
  fi
  echo "failing" > "$STATE"
  exit 1
fi

log "VERDICT: all probes passed"
if [ "$PREV" = "failing" ]; then
  notify_telegram "🟢 AWCMS synthetic check recovered" "$BASE — all probes passing again." \
    || log "notification failed (log remains the record)"
fi
echo "passing" > "$STATE"
