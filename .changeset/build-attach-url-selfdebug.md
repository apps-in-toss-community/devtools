---
'@ait-co/devtools': patch
---

feat(mcp): build_attach_url에 selfdebug 옵션 추가 — launcher self-target QR 발급 (#543)

`build_attach_url` 도구에 `selfdebug?: boolean` 파라미터를 추가한다.

- `true`(env 2 / relay-sandbox 전용): `buildLauncherAttachUrl`이 생성하는 URL에 `&selfdebug=1`을 추가. launcher PWA가 자기 문서를 CDP target으로 등록(#531 소비측 완성).
- env 3/4(relay-staging/relay-live)에서 `selfdebug=true`를 전달하면 명시 에러로 거부 — launcher 전용 기능임을 안내.
- `false` 또는 생략 시 기존 출력 byte-identical (하위 호환 무변경).
- 도구 descriptor description에 single-attach 모델 명시: self-target attach 시 미니앱 target evict.
