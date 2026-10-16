---
"awcms": patch
---

fix(identity-access): `isIpInAnyCidr` now accepts a CIDR prefix only when it is all digits and in range, so a malformed machine-credential entry such as `10.0.0.0/` (previously read as `/0`, matching every address) matches nothing, as documented.
