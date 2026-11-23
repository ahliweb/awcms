---
"awcms": patch
---

Remove developer-machine paths and deployment-specific infrastructure details from tracked files. Example hosts and sender addresses now use `example.com`. The synthetic check no longer assumes a notification script location: set `AWCMS_NOTIFY_LIB` to enable alerts, and set `AWCMS_BASE_URL` to the host to probe. Job, backup and log directory defaults now derive from `$HOME`, and the generated crontab template uses `/opt/awcms-jobs` placeholders (edit them to your install path).
