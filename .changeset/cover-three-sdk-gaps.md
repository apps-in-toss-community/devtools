---
'@ait-co/devtools': patch
---

feat(mock): cover 3 previously-uncovered SDK APIs (getAnonymousKey,
requestTossPayPaysBilling, requestNotificationAgreement) with proper
mocks. requestNotificationAgreement signature is verified against
@apps-in-toss/web-framework via __typecheck.ts; the other two are not
re-exported from the package's main entry point so their Assert is
intentionally omitted (mocks remain available for direct deep imports
and future SDK surface expansion).
