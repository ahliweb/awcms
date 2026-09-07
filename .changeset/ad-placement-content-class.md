---
"awcms": minor
---

feat(blog-content): add editorial-disclosure classification to ad placements (Issue #783)

`awcms_news_portal_ad_placements` gains a `content_class` column (`sql/151`, `NOT NULL DEFAULT 'standard'`, CHECK-constrained to `standard | advertorial | sponsored`) so a derived site can disclose paid/sponsored content — an editorial-ethics and, in many jurisdictions, regulatory requirement for a news outlet. It classifies the placement (the booking), not the referenced media object, since the same creative can run as `standard` in one slot and `sponsored` in another.

`GET /api/v1/news-portal/ad-placements/active`'s public projection now includes `contentClass` for every returned placement. `POST`/`PATCH /api/v1/news-portal/ad-placements[/{id}]` accept an optional `contentClass`, validated against the same three-item vocabulary (rejecting anything else with `400 VALIDATION_ERROR`) and defaulting to `standard` on create. No new permission was added — this reuses the existing `blog_content.ad_placements.{read,configure}` permissions.
