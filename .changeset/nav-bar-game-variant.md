---
'@ait-co/devtools': patch
---

AIT host nav bar `game` 변형을 추가했다. 기존 `partner` 변형(흰 배경 + 뒤로가기 + 앱 아이콘/이름 + ⋯/×)에 더해, `game`은 투명 배경 + ⋯/× 만 그려서 풀스크린 게임 캔버스를 가리지 않게 한다. Viewport 탭의 "Nav bar type" select로 토글 가능하며, `aitState.patch('viewport', { aitNavBarType: 'game' })`로도 변경할 수 있다. 기본값은 `partner`로 기존 동작을 보존한다.
