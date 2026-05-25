---
'@ait-co/devtools': patch
---

feat(mcp): measure_safe_area 툴 추가 + ViewportPreset provenance 필드

- CdpCommandMap에 Runtime.evaluate 타입 추가 (예고된 확장 지점 실현)
- measure_safe_area MCP 툴: relay 실기기에서 safe-area 프로브 실행 후 정규화 반환
- ViewportPreset에 safeAreaProvenance 필드 추가 (measured/extrapolated/placeholder)
- 패널 Viewport 탭에 추정치/미측정 뱃지 렌더링
- catalog stale 정정: default top 47→54, iPhone 15 Pro preset 상태 정정
