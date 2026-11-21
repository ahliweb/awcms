---
"awcms": patch
---

fix(resilience): the WhatsApp (Fonnte, Meta Cloud, StarSender), Telegram and push (Web Push, FCM) adapters now reserve the circuit breaker's single half-open probe per provider call (#1409). Each `send` calls `tryAcquire` first and hands the probe back in a `finally` when the call gave the breaker no verdict (credential problem, dead subscription, bad message, throw), so a half-open breaker lets exactly one message of a batch reach the provider. A refused send returns `skipped: true` (nothing reached the provider) and the dispatcher holds the row with `retry_count` unchanged and no delivery attempt recorded: WhatsApp holds it for the sender-hold window, Telegram releases it and the rest of the batch for 30 s, push defers it for 30 s (new `deferred` counter). Isolation stays per breaker key (per WhatsApp sender). `docs/awcms/database-pooling` (EN and ID) no longer lists these dispatchers as a remaining gap.
