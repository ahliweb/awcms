---
"awcms": patch
---

fix(identity-access): assignment-create segregation-of-duties checks now consider the subject's active, not-yet-expired business-scope assignments whose effective period overlaps the new assignment's period, including ones that start in the future. Previously only assignments in force at the moment of creation were checked, so a conflicting assignment could be granted today alongside one starting tomorrow. Other callers of `resolveSoDAssignmentFacts` keep the current-only behaviour; error codes and response shapes are unchanged.
