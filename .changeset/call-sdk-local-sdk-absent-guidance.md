---
"@ait-co/devtools": patch
---

`call_sdk`의 sdk-absent 에러 안내를 connection 종류에 따라 분기했다 (#360). 같은 "window.__sdkCall 부재"라도 다음 행동은 정반대다 — relay(env 3/4)면 dogfood 빌드가 아니라는 뜻이라 `ait build && aitcc app deploy` 재배포가 맞고, local(`--target=local`, env 1 로컬 브라우저)이면 재배포가 아니라 `pnpm dev` dev 서버와 unplugin alias(`@apps-in-toss/web-framework` → devtools mock) resolve를 확인하는 게 맞다. 이전에는 두 경우 모두 relay/dogfood 안내만 떠서 local 세션 사용자를 잘못된 방향으로 이끌었다. `sdkAbsentError`/`classifyToolError`에 `isLocal` 파라미터를 추가하고(생략 시 기존 relay 안내 유지 — 하위 호환), call_sdk 핸들러와 catch 경로 양쪽이 `conn.kind === 'local'`을 전달하도록 배선했다. `call_sdk` 도구 description도 두 환경의 안내를 함께 명시하도록 갱신했다.
