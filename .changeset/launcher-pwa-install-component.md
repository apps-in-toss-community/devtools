---
'@ait-co/devtools': patch
---

launcher의 정적 설치 안내 카드를 `@khmyznikov/pwa-install` Web Component로 교체했습니다. "Install launcher to your phone" 버튼 하나로 Android Chrome 인앱 프롬프트, iOS Safari "공유 → 홈 화면에 추가" 일러스트, Firefox/Samsung Internet 수동 안내까지 플랫폼별 네이티브 흐름이 자동으로 안내됩니다 — `beforeinstallprompt` 직접 처리나 플랫폼 분기 코드 없이.

Replace the launcher's hand-rolled install hint card with the `@khmyznikov/pwa-install` Web Component. A single "Install launcher to your phone" CTA now triggers the platform-native flow automatically — Android Chrome's in-app install prompt, iOS Safari's Share → Add to Home Screen illustration, and Firefox/Samsung Internet's manual instruction card — without us needing to handle `beforeinstallprompt` or branch on user-agent ourselves.
