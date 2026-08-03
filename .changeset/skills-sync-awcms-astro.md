---
"awcms": patch
---

Skill catalogue: correct two claims that stopped being true

`.claude/skills/README.md` told readers `repo:inventory:*` is "genuinely absent"
and that `package.json` has 75 scripts. Both landed since: #374 shipped
`repo:inventory:generate`/`:check` with the generator for `awcms/repo-inventory.md`,
and the script count is 82. A catalogue that names a real script as missing sends
the next reader to build what already exists — the same failure shape ADR-0062
gates for `SKILL.md`, in the one file that gate does not read.

`awcms-jualanku-porting` carried two more. Its description said the registry is
"still 20 modules" (it is 21), and its first binding decision described the
ADR-0030 scope-hierarchy port as base returning `resolved: false` fail-closed —
true until ADR-0060 gave it a provider, and misleading after. What is still open
is narrower and now stated: the merchant scope SHAPE needs its own admission ADR.

Verified against code, not memory: `Object.keys(scripts).length`, the module
registry, and the ADR files themselves.
