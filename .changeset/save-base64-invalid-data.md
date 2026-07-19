---
'@ait-co/devtools': patch
---

saveBase64Data가 빈 `data`를 native envelope(`INVALID_DATA`)으로 거부한다. 기존에는 anchor click만 해서 무조건 resolve했는데, 실기기는 rejected로 떨어진다.
