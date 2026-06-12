---
'@ait-co/devtools': patch
---

fix(launcher): letterbox 감지 시 screen.height px 보정 — ICB 오보고 우회 (#527)

iOS standalone PWA의 letterbox 감지기(#491)가 발화하면 이제 경고 배너 표시에 그치지 않고 실제 레이아웃을 보정한다.

- 루트 컨테이너에 `height: screen.height px` 명시 — ICB 오보고(797) 우회
- 파트너 모드 iframe height: `calc(100% - env(top) - 54px)` → `screen.height - envTop - 54` px
- 게임 모드 iframe height: `100%` → `screen.height` px
- inset 브리지: 보정 적용 시 bottom inset 실값(34) 복원 — `computeBridgeInsets`에 `letterboxCorrected` 파라미터 추가(기본 true)
- 배너 메시지 톤 다운: 경고 → 보정 적용 안내 (ko/en 짝)

미감지 경로는 byte-identical 유지.

> 터치 히트테스팅 미검증: 보정 영역(하단 47pt)에서의 터치 응답은 페인트만 확인됨 — 폰 재검증 라운드에서 버튼 탭으로 확인 예정.
