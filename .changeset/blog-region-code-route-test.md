---
"awcms": patch
---

test(blog_content): the `regionCode` field of blog posts is now exercised through the real `POST` and `PATCH /api/v1/blog/posts` handlers (set, untouched when absent, cleared with `null`, malformed value refused), not only through the directory. No behaviour change.
