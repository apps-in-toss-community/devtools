---
"@ait-co/devtools": patch
---

feat(mock): 광고 더미 fidelity — TossAds 콜백 발화 + destroy 누수 수정 + 인터랙티브 패널 컨트롤 (#196)

slot 레지스트리로 placeholder를 추적해 `destroy`/`destroyAll`/반환 `destroy`가 실제 엘리먼트를 제거한다(누수 수정). `attachBanner`의 `BannerSlotCallbacks`와 `initialize` 콜백을 결정론적으로 발화하고, AdMob reward의 하드코딩을 `state.ads.rewardUnitType`/`rewardAmount`로 파라미터화한다. 패널 Ads 탭에 콜백 결과(loaded/no-fill/reward/dismissed/clicked/failed)·배너 인터랙티브 컨트롤 추가. 시그니처는 SDK 계약 그대로 보존.
