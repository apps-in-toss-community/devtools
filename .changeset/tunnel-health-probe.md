---
'@ait-co/devtools': patch
---

feat: tunnel drop recovery — periodic health probe + auto-reissue (#290)

cloudflared quick tunnel은 수 시간 후 drop될 수 있어, drop 시 다음 호출에서 
timeout으로만 드러나 사용자가 원인을 알 수 없었음.

- `startTunnelHealthProbe`: 60초 간격 HTTP HEAD probe로 tunnel 생사 확인
- 2회 연속 실패 시 새 tunnel 자동 재발급 (옵션 A 채택)
- 재발급 성공 시 새 wssUrl로 attach 배너 재출력, 사용자에게 재스캔 안내
- 3회 재발급 모두 실패 시 permanent drop으로 마킹 (`droppedAt` 설정) + 
  서버 재시작 안내
- `TunnelStatus`에 `droppedAt` / `reissueAttempts` 필드 추가 → 
  `list_pages` 응답에 drop 상태 노출
- `makeTunnelStatus` 헬퍼로 TunnelStatus 생성 일원화
