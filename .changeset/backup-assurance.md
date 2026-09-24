---
"awcms": minor
---

ops(backup): complete production backup assurance with encryption, authenticated manifests, off-site copies, and automated restore drills (#812)

`deploy/backup/` gains `manifest.sh`, `offsite-copy.sh` and `restore-drill.sh`, and `backup-postgres.sh`/`restore-postgres.sh` gain opt-in `age` encryption-at-rest plus an HMAC-SHA256-authenticated recovery manifest — closing the three controls the production-preflight docs had correctly said were not implemented since the 27 August correction. Setting `BACKUP_AGE_RECIPIENTS_FILE`/`BACKUP_HMAC_KEY_FILE` together at backup time (and `RESTORE_AGE_IDENTITY_FILE`/`BACKUP_HMAC_KEY_FILE` together at restore time) turns on encryption; setting only one of a pair fails closed. `restore-drill.sh` is a new unattended, cron/CI-capable orchestrator with no code path that can target production. Every existing safe default is unchanged: no credentials printed, no final-looking artifact left on failure, non-destructive restore drill by default, and the plain unencrypted mode (offline/LAN profile) is byte-for-byte unchanged. Decision analysis (age vs GnuPG vs OpenSSL enc; HMAC vs detached signature) recorded in ADR-0123.
