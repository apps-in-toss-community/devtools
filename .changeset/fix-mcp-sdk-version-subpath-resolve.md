---
'@ait-co/devtools': patch
---

mcpVersion null fix — SDK 메인 엔트리가 pnpm CJS 가상 스토어에서 MODULE_NOT_FOUND로 실패하므로, 실제 import되는 subpath(`server/index.js`)를 anchor로 삼아 package.json을 resolve하도록 변경
