---
"awcms": patch
---

test(responsive): cover tablet portrait (768px) and 200% desktop zoom (640×360) in the admin overflow sweep (#884)

`tests/e2e/responsive-360.e2e.ts` now asserts that no static admin screen
scrolls sideways at 360, 640×360 (a 1280×720 desktop at 200% browser zoom —
WCAG 2.1 SC 1.4.10 measures reflow in CSS pixels), 768 (tablet portrait) and
1024px, closing epic #858's "phone, tablet, desktop and 200% zoom" criterion.
All 63 static admin routes already fit at the two new widths, so no product
CSS changed; the change is verification coverage only.
