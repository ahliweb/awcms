---
"awcms": patch
---

test(e2e): the modules-toggle spec now disables `form_drafts`, a module nothing depends on, instead of `reporting`. Modules that register reporting projections declare `reporting` a dependency, so the old target's disable was refused. A new pure guard test fails in `quality` as soon as any module declares a dependency on the spec's target.
