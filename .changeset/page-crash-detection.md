---
'@ait-co/devtools': patch
---

fix(mcp): page crash 감지 — Inspector.targetCrashed / Target.targetDestroyed / Target.detachedFromTarget CDP 이벤트 구독 + per-target lastSeenAt 추적 + opt-in heartbeat (AIT_CDP_HEARTBEAT_MS). list_pages 응답에 crashDetectedAt / crashWarning / lastSeenAt 필드 추가.
