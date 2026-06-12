// Korean string catalog (source of truth — keys are typed from this file).
// Keys follow `<area>.<purpose>` convention. Variable interpolation uses
// `{name}` placeholders resolved by `t(key, { name: value })`.
//
// Some chrome (button labels like "Load", "Show", "Clear", "Apply") is left as
// English in both locales because the panel is an internal devtools surface
// and these terms are universally recognised by developers in both locales.

export const ko = {
  // Panel chrome
  'panel.title': 'AIT DevTools',
  'panel.toggle.title': 'AIT DevTools',
  'panel.close': 'Close',
  'panel.editMode.on': 'EDIT',
  'panel.editMode.off': 'READ-ONLY',
  'panel.editMode.toggleTitle': '패널 편집 모드 전환',
  'panel.tabError': '"{tab}" 탭 렌더링 중 오류가 발생했습니다.',

  // Tab names
  'panel.tab.env': 'Environment',
  'panel.tab.presets': 'Presets',
  'panel.tab.viewport': 'Viewport',
  'panel.tab.permissions': 'Permissions',
  'panel.tab.notifications': 'Notifications',
  'panel.tab.location': 'Location',
  'panel.tab.device': 'Device',
  'panel.tab.iap': 'IAP',
  'panel.tab.ads': 'Ads',
  'panel.tab.events': 'Events',
  'panel.tab.analytics': 'Analytics',
  'panel.tab.storage': 'Storage',

  // Common
  'common.readOnly': '읽기 전용 — mock 응답은 빌드 타임에 고정됩니다.',

  // Consent toast
  'toast.consent.title': '익명 사용 통계를 보낼까요?',
  'toast.consent.body': '도구 개선을 위해 익명 이벤트만 수집해요. 언제든 환경 탭에서 끌 수 있어요.',
  'toast.consent.learnMore': '더 알아보기',
  'toast.consent.accept': '네, 보낼게요',
  'toast.consent.deny': '아니요',

  // Environment tab
  'env.section.platform': 'Platform',
  'env.row.os': 'OS',
  'env.row.appVersion': 'App Version',
  'env.row.environment': 'Environment',
  'env.row.locale': 'Locale',
  'env.section.network': 'Network',
  'env.row.networkStatus': 'Status',
  'env.section.safeArea': 'Safe Area Insets',
  'env.row.safeArea.top': 'Top',
  'env.row.safeArea.bottom': 'Bottom',
  'env.section.navigation': 'Navigation',
  'env.row.iosSwipeGesture': 'iOS swipe-back',
  'env.value.iosSwipeGesture.unset': '미호출',
  'env.value.iosSwipeGesture.enabled': 'enabled',
  'env.value.iosSwipeGesture.disabled': 'disabled',
  'env.hint.iosSwipeGesture':
    'setIosSwipeGestureEnabled의 마지막 호출값. Environment를 toss로 바꾸면 toss-gated 가드가 이 값을 토글합니다.',

  // Environment > Telemetry section
  'env.telemetry.section': 'Telemetry',
  // Tier 0 — opt-out anonymous signal
  'env.telemetry.t0Row': '익명 사용 신호 (Tier 0)',
  'env.telemetry.t0On': 'On',
  'env.telemetry.t0Off': 'Off',
  'env.telemetry.t0TurnOn': 'Turn on',
  'env.telemetry.t0TurnOff': 'Turn off',
  'env.telemetry.t0Desc': '버전·날짜만 수집, PII 없음. 하루 1회. 패키지 개선에 사용됩니다.',
  // Tier 1 — opt-in extended telemetry
  'env.telemetry.row': '확장 텔레메트리 (Tier 1)',
  'env.telemetry.on': 'On',
  'env.telemetry.off': 'Off',
  'env.telemetry.turnOn': 'Turn on',
  'env.telemetry.turnOff': 'Turn off',
  'env.telemetry.anonIdLabel': 'anon_id: {value}',
  'env.telemetry.anonIdNotSet': '(not yet set)',
  'env.telemetry.anonIdCopyTitle': '전체 anon_id 복사',
  'env.telemetry.deleteBtn': '내 데이터 삭제',
  'env.telemetry.deleting': '삭제 중…',
  'env.telemetry.deleted': '삭제 완료',
  'env.telemetry.deleteFailedRetry': '삭제 실패 (다시 시도해주세요)',
  'env.telemetry.deleteFailed': '삭제 실패',
  'env.telemetry.privacyLink': '개인정보 처리방침 →',

  // Environment > Language toggle (new)
  'env.section.language': 'Language',
  'env.language.row': 'Language',
  'env.language.ko': '한국어',
  'env.language.en': 'English',

  // Permissions tab
  'permissions.section.device': 'Device Permissions',

  // Location tab
  'location.section.current': 'Current Location',
  'location.row.latitude': 'Latitude',
  'location.row.longitude': 'Longitude',
  'location.row.accuracy': 'Accuracy',

  // Device tab
  'device.section.modes': 'Device API Modes',
  'device.row.camera': 'Camera',
  'device.row.photos': 'Photos',
  'device.row.location': 'Location',
  'device.row.network': 'Network',
  'device.row.clipboard': 'Clipboard',
  'device.section.mockImages': 'Mock Images ({count})',
  'device.btn.add': '+ Add',
  'device.btn.useDefaults': 'Use defaults',
  'device.btn.clear': 'Clear',
  'device.prompt.camera.title': 'Camera Prompt — 이미지를 선택하세요',
  'device.prompt.photos.title': 'Photos Prompt — 이미지를 선택하세요',
  'device.prompt.location.title': 'Location Prompt — 좌표 입력',
  'device.prompt.locationUpdate.title': 'Location Update — 좌표 전송',
  'device.prompt.fallbackTitle': 'Prompt: {type}',
  'device.prompt.label.lat': 'Lat',
  'device.prompt.label.lng': 'Lng',
  'device.prompt.send': 'Send',
  'device.prompt.cancel': 'Cancel',

  // Device tab — Haptic section
  'device.section.haptic': 'Haptic',
  'device.haptic.lastCall': '마지막 haptic',
  'device.haptic.noneYet': '(아직 없음)',
  'device.haptic.trigger': 'Haptic 트리거',

  // Viewport tab
  'viewport.section.device': 'Device',
  'viewport.row.preset': 'Preset',
  'viewport.row.orientation': 'Orientation',
  'viewport.row.notchSide': 'Notch side',
  'viewport.section.custom': 'Custom size',
  'viewport.row.width': 'Width (px)',
  'viewport.row.height': 'Height (px)',
  'viewport.section.appearance': 'Appearance',
  'viewport.row.showFrame': 'Show frame',
  'viewport.row.showAitNavBar': 'Apps in Toss 내비게이션 바 표시',
  'viewport.row.navBarType': 'Nav bar type',
  'viewport.status.noConstraint': '뷰포트 제약 없음 — body가 창을 가득 채웁니다.',
  'viewport.status.cssPhysical': 'CSS / physical',
  'viewport.status.safeArea': 'Safe area',
  'viewport.status.aitNavBar': 'AIT nav bar',
  'viewport.status.aitNavBarValue': '{height}px → SafeArea top · {type}',
  'viewport.orientation.autoSuffix': '{orient} (auto)',

  // IAP tab
  'iap.section.simulator': 'IAP Simulator',
  'iap.row.nextResult': 'Next Purchase Result',
  'iap.section.tossPay': 'TossPay',
  'iap.row.tossPayResult': 'Next Payment Result',
  'iap.section.pending': 'Pending Orders ({count})',
  'iap.empty.pending': '(대기 중인 주문 없음)',
  'iap.section.completed': 'Completed Orders ({count})',
  'iap.empty.completed': '(완료된 주문 없음)',
  'iap.btn.complete': 'Complete',
  'iap.label.pending': 'PENDING',

  // Events tab
  'events.section.navigation': 'Navigation Events',
  'events.btn.triggerBack': 'Back 이벤트 발생',
  'events.btn.triggerHome': 'Home 이벤트 발생',
  'events.section.login': 'Login',
  'events.row.loggedIn': 'Logged In',
  'events.row.tossLoginIntegrated': 'Toss Login Integrated',

  // Analytics tab
  'analytics.section.log': 'Analytics Log ({count})',
  'analytics.btn.clear': 'Clear',
  'analytics.calls.section': 'SDK Calls ({count})',
  'analytics.calls.btn.clear': 'Clear',
  'analytics.calls.empty': '(아직 SDK 호출 없음)',

  // Storage tab
  'storage.section.title': 'Storage ({count} items)',
  'storage.btn.clearAll': 'Clear All',
  'storage.empty': '저장된 항목이 없습니다',

  // Presets tab
  'presets.section.builtIn': 'Built-in scenarios',
  'presets.section.saved': 'Saved presets ({count})',
  'presets.section.save': 'Save',
  'presets.save.description':
    'network / permissions / auth / IAP / ads / payment 슬라이스를 캡처합니다.',
  'presets.btn.saveCurrent': '현재 상태를 프리셋으로 저장',
  'presets.btn.apply': 'Apply',
  'presets.btn.reApply': 'Re-apply',
  'presets.btn.delete': 'Delete',
  'presets.empty.saved': '저장된 프리셋이 아직 없습니다.',
  'presets.empty.builtIn': '내장 프리셋이 없습니다.',
  'presets.prompt.label': '프리셋 라벨을 입력하세요',
  'presets.confirm.delete': '"{label}" 프리셋을 삭제할까요?',

  // Ads tab
  'ads.section.state': 'Ads State',
  'ads.row.isLoaded': 'isLoaded',
  'ads.row.forceNoFill': '강제 "no fill"',
  'ads.empty.events': '아직 이벤트가 없습니다',
  'ads.section.googleAdMob': 'GoogleAdMob',
  'ads.section.tossAds': 'TossAds',
  'ads.section.fullScreenAd': 'FullScreenAd',
  'ads.btn.load': 'Load',
  'ads.btn.show': 'Show',
  'ads.section.tossAdsBanner': 'TossAds 배너',
  'ads.row.rewardUnitType': '리워드 단위 타입',
  'ads.row.rewardAmount': '리워드 수량',
  'ads.btn.render': 'Render',
  'ads.btn.noFill': 'No-fill',
  'ads.btn.click': 'Click',
  'ads.btn.destroy': 'Destroy',

  // Notifications tab
  'notifications.section.title': 'requestNotificationAgreement',
  'notifications.option.newAgreement': 'newAgreement (최초 동의)',
  'notifications.option.alreadyAgreed': 'alreadyAgreed (이미 동의됨)',
  'notifications.option.agreementRejected': 'agreementRejected (사용자 거절)',

  // qr-http-server — lang switcher (dashboard / attach pages)
  'dashboard.lang.ko': '한국어',
  'dashboard.lang.en': 'English',

  // qr-http-server — dashboard page (server-side, Node, per-request)
  'dashboard.title': 'AIT 디버그 Dashboard',
  'dashboard.updated': '마지막 갱신: {ts}',
  'dashboard.tunnel.section': '터널 상태',
  'dashboard.tunnel.up': '연결됨',
  'dashboard.tunnel.down': '끊어짐',
  'dashboard.attach.section': 'Attach QR',
  'dashboard.attach.hint': 'build_attach_url MCP tool을 호출하면 QR이 여기에 표시됩니다.',
  'dashboard.pages.section': '연결된 Pages',
  'dashboard.pages.empty': 'attach된 페이지 없음',

  // qr-http-server — url-box copy button
  'dashboard.url.copy': '복사',
  'dashboard.url.copied': '복사됨',

  // qr-http-server — inspector open link (#503)
  'dashboard.inspector.section': '인스펙터',
  'dashboard.inspector.open': '디버그 툴 열기',
  'dashboard.inspector.waiting': '페이지를 attach하면 "디버그 툴 열기" 버튼이 표시됩니다',

  // qr-http-server — /inspector stable entry (issue #530)
  'inspector.error.noTarget': '연결된 페이지가 없습니다. 기기를 attach한 후 다시 시도하세요.',
  'inspector.error.relayDown': 'relay가 활성화되지 않았습니다. start_debug로 relay를 기동하세요.',

  // qr-http-server — attach page (server-side, Node, per-request)
  // 카피는 세션 mode별로 sandbox(환경 2) / intoss(환경 3·4) family로 분기한다 (#468).
  'attach.title': 'AIT 디버그 세션 — QR 스캔',
  'attach.deployment': 'deployment: {label}',
  'attach.steps.section': '스캔 절차',
  'attach.faq.section': '진단 체크리스트',
  'attach.url.section': 'URL (fallback)',

  // qr-http-server — attach page mode 라벨 (환경 가시화, #468)
  'attach.mode.sandbox': '환경 2 — AITC Sandbox App (PWA)',
  'attach.mode.intossDev': '환경 3 — intoss-private relay dev',
  'attach.mode.intossLive': '환경 4 — intoss live relay debug',

  // attach page — sandbox family (환경 2: launcher PWA, 토스 앱·_deploymentId 개념 없음)
  'attach.sandbox.step1':
    '홈 화면의 launcher PWA 아이콘으로 실행하세요 (Safari 주소창이 보이면 standalone이 아닙니다).',
  'attach.sandbox.step2':
    'launcher 안의 <strong>"QR 카메라로 스캔"</strong>으로 이 QR 코드를 스캔하세요.',
  'attach.sandbox.step3': '미니앱이 풀스크린으로 열리고 디버그 세션이 자동으로 attach됩니다.',
  'attach.sandbox.faq.notInstalled':
    '<strong>launcher가 설치돼 있지 않은 경우</strong> — <code>devtools.aitc.dev/launcher/</code>를 한 번 열어 홈 화면에 추가하세요',
  'attach.sandbox.faq.cameraApp':
    '<strong>카메라 앱으로 스캔하면 Safari 탭으로 열립니다 (하단 탭 바 노출)</strong> — launcher 아이콘으로 다시 실행해 인앱 스캔을 사용하세요',
  'attach.sandbox.faq.totp':
    '<strong>QR이 만료된 경우 (TOTP — 코드 1개는 30초 창, 만료 후 ~3분(±6 step) 이내 소급 허용)</strong> — 새 QR을 다시 스캔하세요',
  'attach.sandbox.faq.chii':
    '<strong>Chii 주입 실패 / 콘솔이 비어 있는 경우</strong> — 미니앱 번들에 <code>in-app</code> debug import가 있는지 확인',

  // attach page — intoss family (환경 3·4: 토스 앱 deep-link)
  'attach.intoss.step1': '토스 앱을 실행하세요.',
  'attach.intoss.step2': '폰 카메라 앱으로 QR 코드를 스캔하세요.',
  'attach.intoss.step3': '팝업이 뜨면 <strong>"토스로 열기"</strong>를 탭하세요.',
  'attach.intoss.step4': '미니앱이 열리고 디버그 세션이 자동으로 attach됩니다.',
  'attach.intoss.faq.appNotOpen':
    '<strong>토스 앱이 안 열리는 경우</strong> — 앱 버전 확인, 카메라 앱으로 스캔 (토스 앱 내 QR 리더 X)',
  'attach.intoss.faq.prepare':
    '<strong>미니앱이 PREPARE 상태에서 멈추는 경우</strong> — deep-link에 <code>_deploymentId</code> 파라미터가 있는지 확인',
  'attach.intoss.faq.chii':
    '<strong>Chii 주입 실패 / 콘솔이 비어 있는 경우</strong> — 미니앱 번들에 <code>in-app</code> debug import가 있는지 확인',
  'attach.intoss.faq.totp':
    '<strong>TOTP gate Layer C가 비활성인 경우</strong> — relay 서버에 <code>AIT_DEBUG_TOTP_SECRET</code>이 설정돼 있는지 확인',
  // 환경 4(relay-live) 전용 — intoss family에 런타임으로 한 줄 추가된다 (#468).
  'attach.intoss.faq.liveReadOnly':
    '<strong>LIVE 세션은 read-only입니다</strong> — <code>call_sdk</code>/<code>evaluate</code> 실행에는 명시적 <code>confirm</code>이 필요합니다',

  // Launcher PWA
  'launcher.title': 'AITC DevTools Launcher',
  'launcher.description': '터미널 QR을 스캔하거나 URL을 입력하세요.',
  'launcher.installCta': '폰에 런처 설치하기',
  'launcher.urlPlaceholder': 'https://example.trycloudflare.com',
  'launcher.openBtn': 'Open',
  'launcher.scanBtn': 'QR 카메라로 스캔',
  'launcher.noCamera': '카메라를 사용할 수 없습니다 — URL을 직접 붙여넣으세요.',
  'launcher.cameraError': '카메라에 접근할 수 없습니다 — URL을 직접 붙여넣으세요.',
  'launcher.invalidUrlHttps': '올바른 https:// URL을 입력하세요 (터미널의 터널 URL).',
  'launcher.invalidUrl': '올바른 http(s):// URL을 입력하세요.',
  'launcher.debugAuthFailed': '디버그 연결 인증 실패',
  'launcher.debugAuthFailedHint': 'QR 코드가 만료되었을 수 있어요. 새 QR을 다시 스캔하세요.',
  'launcher.debugAuthExpiredHint':
    '디버그 세션이 만료됐어요. Mac의 attach 페이지에서 새 QR을 스캔하세요.',
  'launcher.debugAuthRescanCta': '새 QR 스캔하기',
  'launcher.diagTitle': '뷰포트 진단',
  'launcher.diagYes': '예',
  'launcher.diagNo': '아니요',
  'launcher.letterboxDetected': 'letterbox 보정 +{pt}pt 적용됨 — 화면 전체를 사용합니다.',
  // Nav-bar emulation (#495/#510)
  'launcher.navbar.defaultTitle': '미니앱',
  'launcher.navbar.back': '뒤로가기',
  'launcher.navbar.menu': '메뉴',
  'launcher.navbar.close': '닫기',
  'launcher.navbar.menuRescan': '다시 스캔',
  'launcher.navbar.menuDiag': '뷰포트 진단',
  'launcher.navbar.menuLanguage': '언어',
} as const;

export type StringKey = keyof typeof ko;
