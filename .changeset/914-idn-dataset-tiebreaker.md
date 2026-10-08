---
"awcms": patch
---

fix(idn-admin-regions): dataset rollback no longer refuses with `NO_PREVIOUS_DATASET` when two activations land close together (#914). `activated_at` is `now()`, the instant the activating transaction started, so the active dataset can carry an `activated_at` equal to, or earlier than, the dataset it superseded. The strict `activated_at < active.activated_at` filter then excluded the real target. Rollback now picks the most recently activated `superseded` dataset (`ORDER BY activated_at DESC, id DESC`), and `listDatasets` orders by `created_at DESC, id DESC` so equal timestamps no longer give an unspecified order.
