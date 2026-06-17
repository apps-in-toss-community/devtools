---
'@ait-co/devtools': patch
---

fix(launcher): letterbox 보정 전파 누수 2건 수정 (#541)

1. setup 화면 `minHeight: '100dvh'` ICB 갇힘: `100%`로 교체해 parent fixed div(inset:0)를 통해 html/body force(screen.height)가 전파되도록 수정.
2. 배너 게이트 비대칭: `|| letterboxShortfallPx > 0` 의존을 `correctionPhase !== 'held'`로 대체해 `letterboxDetected` 기반으로 게이트 통일.
