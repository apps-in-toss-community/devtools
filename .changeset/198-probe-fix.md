---
'@ait-co/devtools': patch
---

fix(mcp): measure_safe_area probe가 window.__sdk.SafeAreaInsets.get()과 getSafeAreaInsets() 경로를 올바르게 호출하도록 수정. SDK 호출 실패 시 sdkInsetsError 필드로 명시 (silent null 제거). navBarHeightSource 필드 추가.
