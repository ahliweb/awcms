---
"awcms": patch
---

fix(deps): close advisories in sharp 0.35.4 (GHSA-wq5f-xc86-pv6w, librsvg CVE-2026-96889), shell-quote 1.10.0 (GHSA-pqg4-j6r4-53mv, command injection), and source-map-js 1.2.1 (GHSA-68fv-2mgg-jv7q, event-loop DoS) by adding package.json overrides for sharp ^0.35.5, shell-quote ^1.11.0, and source-map-js ^1.2.2 (#920).
