---
'@ait-co/devtools': patch
---

iPhone 15 Pro landscape safe-area 실측값 반영(#198/#232).

- iPhone 15 Pro preset에 landscape bottom inset 20 추가 + provenance `measured` 승급 (2026-05-28, portrait + landscape 양쪽 실측).
- `computeSafeAreaInsets` iPhone landscape 분기를 좌우 대칭으로 수정 — CSS env()와 SDK SafeAreaInsets 모두 `left=right=notchInset` (relay 세션 ground truth).
- `landscapeSide` 필드 + Panel UI select + state default 제거 (잘못된 mental model).
