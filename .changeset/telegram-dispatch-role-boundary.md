---
"awcms": patch
---

security(telegram_engagement): defence in depth, dedicated role boundary for the customer Telegram dispatcher.

- `sql/436`: `awcms_telegram_engagement_dispatch` no longer writes `awcms_channel_accounts` or `awcms_channel_account_health` directly. A bot's health is recorded through the fixed-body SECURITY DEFINER `awcms_telegram_engagement_report_bot_health` (owner `awcms_telegram_engagement_health_report`, NOLOGIN, memberless; EXECUTE for the dispatcher only) from a closed verdict; the function decides every written value. A contact the role marks `blocked` stores `version = OLD + 1` (trigger).
- `sql/437`: the role carries `idle_in_transaction_session_timeout = 15s` and `transaction_timeout = 30s`.
- `security:readiness` pins the function, the trigger, both settings and the owner's column matrix exactly, and probes them as the role.
