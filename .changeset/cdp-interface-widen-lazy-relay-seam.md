---
"@ait-co/devtools": patch
---

Internal refactor (behavior-preserving): widen `CdpConnection` interface with optional `close`, `refreshTargets`, and `waitForFirstTarget` members, and introduce a `createRelayConnection` factory seam — preparing for dual-connection support (#348, PR-2). No runtime behavior changes.
