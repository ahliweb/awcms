---
"awcms": patch
---

Login card entrance is now transform-only (`@keyframes auth-card-rise`,
`translateY`) instead of the shared `.fade-in-up` utility that fades from
`opacity: 0`. Fading the whole card — including its text — from transparent can
let an axe-core contrast scan read semi-transparent text as a contrast
violation if it scans mid-animation; a transform-only entrance keeps the text
fully opaque throughout. A local `prefers-reduced-motion` guard neutralises it
(motion.css's global reduced-motion block only targets its utility classes).
CSS/markup only — the DOM contract and login logic are unchanged. Documented as
the canonical rule in doc 14 §Motion / §Auth screen.
