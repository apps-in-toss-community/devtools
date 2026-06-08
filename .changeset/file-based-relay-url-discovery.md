---
"@ait-co/devtools": patch
---

환경 2 cold-start URL을 `.ait_urls` 파일 자동 발견으로 대체 (#424)

env-2(AITC Sandbox PWA) cold-start 시 `AIT_RELAY_BASE_URL`·`AIT_TUNNEL_BASE_URL`을 매번 수동으로 env var에 복붙해야 했던 문제를 파일 기반 자동 발견으로 대체한다. unplugin이 tunnel/relay URL을 `<projectRoot>/.ait_urls`(mode 0600)에 기록하고, MCP 데몬은 env가 설정되지 않은 경우 해당 파일에서 URL을 읽는다(env가 있으면 env 우선). `cleanup()` 시 파일을 삭제해 stale URL이 다음 부팅에 남지 않도록 한다. `.ait_relay` TOTP 시크릿 저장 패턴을 그대로 재사용(쓰기=unplugin만, 읽기=daemon 전용 read-only). SECRET-HANDLING: URL 값과 파일 경로는 어느 로그·stderr·오류 메시지에도 절대 출력하지 않는다.
