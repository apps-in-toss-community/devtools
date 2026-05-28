---
"@ait-co/devtools": patch
---

`devtools-mcp` bin이 npx/npm bin shim symlink로 실행되면 entrypoint 감지 실패해 MCP server가 기동조차 안 하던 회귀 fix — `argv[1]`을 `realpathSync`로 정규화 후 `import.meta.url`과 비교
