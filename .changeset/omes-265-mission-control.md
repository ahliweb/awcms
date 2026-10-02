---
"awcms": minor
---

feat(omes-control): 3D Mission Control workspace at /admin/omes/mission-control (ahliweb/omes#265)

New read-only 3D Mission Control screen at `/admin/omes/mission-control` renders the fleet's live state as a decorative WebGL2 scene, backed by an accessible, JavaScript-free object list (the canonical view). Every object is a reference linking back to its existing canonical screen — it is a derived projection, not a new authority. Guarded by `omes_control.servers.read` (no new permission); each source is included only when the viewer can read it. The scene polls every 15 seconds while visible; stale/unknown objects are never rendered as healthy. Read-only in this release: action buttons and historical replay are not yet implemented (ahliweb/omes#267 and #266).
