---
"@ait-co/devtools": patch
---

feat(launcher): selfdebug=1 opt-in self-target — launcher 문서 CDP 직접 관측 (#531)

launcher URL에 `selfdebug=1`과 `relay=<wss>` 파라미터를 추가하면 launcher 문서 자체가 Chii CDP target으로 등록된다. 에이전트가 `measure_safe_area` / `evaluate` / `get_dom_document` 등을 launcher 문서에 직접 실행할 수 있어, 기하·스타일·배너 상태를 사람 눈 없이 관측 가능하다(#499/#527 letterbox 오진 사가의 구조적 해소). 파라미터 없으면 기존 동작 byte-identical 무변경.
