import type { StringKey } from './ko.js';

// English translations. Mirrors every key in `ko.ts`; missing keys fall back to
// the key string at runtime (see `t()` in index.ts), but the `Record<StringKey,
// string>` type below means a missing key will typecheck-fail.

export const en: Record<StringKey, string> = {
  // Panel chrome
  'panel.title': 'AIT DevTools',
  'panel.toggle.title': 'AIT DevTools',
  'panel.close': 'Close',
  'panel.editMode.on': 'EDIT',
  'panel.editMode.off': 'READ-ONLY',
  'panel.editMode.toggleTitle': 'Toggle panel edit mode',
  'panel.tabError': 'Error rendering "{tab}" tab.',

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
  'common.readOnly': 'Read-only — mock responses are controlled at build time.',

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
  'env.value.iosSwipeGesture.unset': 'not called',
  'env.value.iosSwipeGesture.enabled': 'enabled',
  'env.value.iosSwipeGesture.disabled': 'disabled',
  'env.hint.iosSwipeGesture':
    'Last value passed to setIosSwipeGestureEnabled. Switching Environment to toss lets a toss-gated guard toggle this.',

  // Environment > Language toggle
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
  'device.prompt.camera.title': 'Camera Prompt — Select an image',
  'device.prompt.photos.title': 'Photos Prompt — Select images',
  'device.prompt.location.title': 'Location Prompt — Enter coordinates',
  'device.prompt.locationUpdate.title': 'Location Update — Send coordinates',
  'device.prompt.fallbackTitle': 'Prompt: {type}',
  'device.prompt.label.lat': 'Lat',
  'device.prompt.label.lng': 'Lng',
  'device.prompt.send': 'Send',
  'device.prompt.cancel': 'Cancel',

  // Device tab — Haptic section
  'device.section.haptic': 'Haptic',
  'device.haptic.lastCall': 'Last haptic',
  'device.haptic.noneYet': '(none yet)',
  'device.haptic.trigger': 'Trigger haptic',

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
  'viewport.row.showAitNavBar': 'Show Apps in Toss nav bar',
  'viewport.row.navBarType': 'Nav bar type',
  'viewport.status.noConstraint': 'No viewport constraint — body fills the window.',
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
  'iap.empty.pending': '(no pending orders)',
  'iap.section.completed': 'Completed Orders ({count})',
  'iap.empty.completed': '(no completed orders)',
  'iap.btn.complete': 'Complete',
  'iap.label.pending': 'PENDING',

  // Events tab
  'events.section.navigation': 'Navigation Events',
  'events.btn.triggerBack': 'Trigger Back Event',
  'events.btn.triggerHome': 'Trigger Home Event',
  'events.section.login': 'Login',
  'events.row.loggedIn': 'Logged In',
  'events.row.tossLoginIntegrated': 'Toss Login Integrated',

  // Analytics tab
  'analytics.section.log': 'Analytics Log ({count})',
  'analytics.btn.clear': 'Clear',
  'analytics.calls.section': 'SDK Calls ({count})',
  'analytics.calls.btn.clear': 'Clear',
  'analytics.calls.empty': '(no SDK calls yet)',

  // Storage tab
  'storage.section.title': 'Storage ({count} items)',
  'storage.btn.clearAll': 'Clear All',
  'storage.empty': 'No items in storage',

  // Presets tab
  'presets.section.builtIn': 'Built-in scenarios',
  'presets.section.saved': 'Saved presets ({count})',
  'presets.section.save': 'Save',
  'presets.save.description': 'Capture network / permissions / auth / IAP / ads / payment slices.',
  'presets.btn.saveCurrent': 'Save current as preset',
  'presets.btn.apply': 'Apply',
  'presets.btn.reApply': 'Re-apply',
  'presets.btn.delete': 'Delete',
  'presets.empty.saved': 'No saved presets yet.',
  'presets.empty.builtIn': 'No built-in presets.',
  'presets.prompt.label': 'Preset label?',
  'presets.confirm.delete': 'Delete preset "{label}"?',

  // Ads tab
  'ads.section.state': 'Ads State',
  'ads.row.isLoaded': 'isLoaded',
  'ads.row.forceNoFill': 'Force "no fill"',
  'ads.empty.events': 'No events yet',
  'ads.section.googleAdMob': 'GoogleAdMob',
  'ads.section.tossAds': 'TossAds',
  'ads.section.fullScreenAd': 'FullScreenAd',
  'ads.btn.load': 'Load',
  'ads.btn.show': 'Show',
  'ads.section.tossAdsBanner': 'TossAds Banner',
  'ads.row.rewardUnitType': 'Reward unit type',
  'ads.row.rewardAmount': 'Reward amount',
  'ads.btn.render': 'Render',
  'ads.btn.noFill': 'No-fill',
  'ads.btn.click': 'Click',
  'ads.btn.destroy': 'Destroy',

  // Notifications tab
  'notifications.section.title': 'requestNotificationAgreement',
  'notifications.option.newAgreement': 'newAgreement (first-time agree)',
  'notifications.option.alreadyAgreed': 'alreadyAgreed (already opted-in)',
  'notifications.option.agreementRejected': 'agreementRejected (user declined)',

  // qr-http-server — lang switcher (dashboard / attach pages)
  'dashboard.lang.ko': '한국어',
  'dashboard.lang.en': 'English',

  // qr-http-server — dashboard page (server-side, Node, per-request)
  'dashboard.title': 'AIT Debug Dashboard',
  'dashboard.updated': 'Last updated: {ts}',
  'dashboard.tunnel.section': 'Tunnel status',
  'dashboard.tunnel.up': 'Connected',
  'dashboard.tunnel.down': 'Disconnected',
  'dashboard.attach.section': 'Attach QR',
  'dashboard.attach.hint': 'Call the start_attach MCP tool to show the QR here.',
  'dashboard.attach.tunnelDown':
    'Relay disconnected — this QR is no longer valid. Restart the relay, then regenerate the QR.',
  'dashboard.pages.section': 'Connected Pages',
  'dashboard.pages.empty': 'No attached pages',

  // qr-http-server — url-box copy button
  'dashboard.url.copy': 'Copy',
  'dashboard.url.copied': 'Copied',

  // qr-http-server — inspector open link (#503)
  'dashboard.inspector.section': 'Inspector',
  'dashboard.inspector.open': 'Open DevTools',
  'dashboard.inspector.waiting': 'Attach a page to enable the "Open DevTools" button',

  // qr-http-server — /inspector stable entry (issue #530)
  'inspector.error.noTarget': 'No page attached. Attach a device and try again.',
  'inspector.error.relayDown': 'Relay is not active. Start a relay session first.',

  // qr-http-server — attach page (server-side, Node, per-request)
  // Copy branches per session mode into sandbox (env 2) / intoss (env 3) families (#468).
  'attach.title': 'AIT Debug Session — QR Scan',
  'attach.deployment': 'deployment: {label}',
  'attach.steps.section': 'How to scan',
  'attach.faq.section': 'Troubleshooting checklist',
  'attach.url.section': 'URL (fallback)',

  // qr-http-server — attach page mode label (environment visibility, #468)
  'attach.mode.sandbox': 'env 2 — AITC Sandbox App (PWA)',
  'attach.mode.intossDev': 'env 3 — intoss-private relay dev',

  // attach page — sandbox family (env 2: launcher PWA; no Toss app / _deploymentId concepts)
  'attach.sandbox.step1':
    'Launch the launcher PWA icon on your home screen (if the Safari address bar is visible, it is not standalone).',
  'attach.sandbox.step2':
    'Scan this QR code with <strong>"Scan QR with camera"</strong> inside the launcher.',
  'attach.sandbox.step3':
    'The mini-app opens fullscreen and the debug session attaches automatically.',
  'attach.sandbox.faq.notInstalled':
    '<strong>Launcher is not installed</strong> — open <code>devtools.aitc.dev/launcher/</code> once and add it to your home screen',
  'attach.sandbox.faq.cameraApp':
    '<strong>Scanning with the camera app opens a Safari tab (bottom tab bar visible)</strong> — relaunch from the launcher icon and use the in-app scanner',
  'attach.sandbox.faq.totp':
    '<strong>QR expired (TOTP — 30-second step, ±6 steps (~3 min) accepted)</strong> — scan a fresh QR code',
  'attach.sandbox.faq.chii':
    '<strong>Chii injection failure / console is empty</strong> — verify the mini-app bundle has an <code>in-app</code> debug import',

  // attach page — intoss family (env 3: Toss app deep-link)
  'attach.intoss.step1': 'Open the Toss app.',
  'attach.intoss.step2': 'Scan the QR code with your phone camera app.',
  'attach.intoss.step3': 'Tap <strong>"Open in Toss"</strong> when the popup appears.',
  'attach.intoss.step4': 'The mini-app opens and the debug session attaches automatically.',
  'attach.intoss.faq.appNotOpen':
    '<strong>Toss app does not open</strong> — check app version; scan with the system camera app (not the Toss in-app QR reader)',
  'attach.intoss.faq.prepare':
    '<strong>Mini-app stuck in PREPARE state</strong> — verify the deep-link has a <code>_deploymentId</code> parameter',
  'attach.intoss.faq.chii':
    '<strong>Chii injection failure / console is empty</strong> — verify the mini-app bundle has an <code>in-app</code> debug import',
  'attach.intoss.faq.totp':
    '<strong>TOTP gate Layer C is inactive</strong> — check that <code>AIT_DEBUG_TOTP_SECRET</code> is set on the relay server',
  // Launcher PWA
  'launcher.title': 'AITC DevTools Launcher',
  'launcher.description': 'Scan the terminal QR code or paste the tunnel URL.',
  'launcher.installCta': 'Install launcher to your phone',
  'launcher.urlPlaceholder': 'https://example.trycloudflare.com',
  'launcher.openBtn': 'Open',
  'launcher.scanBtn': 'Scan QR with camera',
  'launcher.noCamera': 'No camera available — paste the URL instead.',
  'launcher.cameraError': 'Could not access the camera — paste the URL instead.',
  'launcher.invalidUrlHttps': 'Enter a valid https:// URL (the tunnel URL from your terminal).',
  'launcher.invalidUrl': 'Enter a valid http(s):// URL.',
  'launcher.debugAuthFailed': 'Debug connection authentication failed',
  'launcher.debugAuthFailedHint': 'The QR code may have expired. Scan a fresh QR code.',
  'launcher.debugAuthExpiredHint':
    'The debug session has expired. Scan a fresh QR from the attach page on your Mac.',
  'launcher.debugAuthRescanCta': 'Scan a new QR',
  'launcher.diagTitle': 'Viewport diagnostics',
  'launcher.diagYes': 'yes',
  'launcher.diagNo': 'no',
  'launcher.letterboxDetected':
    'An iOS viewport constraint may clip the bottom {pt}pt — rotating to landscape and back to portrait may resolve it.',
  'launcher.letterboxClipped':
    'An iOS viewport bug makes the bottom {pt}pt unusable — rotating to landscape and back to portrait may recover it.',
  // #536: verdict reason labels for diag panel
  'launcher.diagVerdictLabel': 'Verdict reason',
  'launcher.diagSafeAreaTrace': 'top re-measure trace',
  'launcher.diagVerdict.detected': '✓ letterbox correction',
  'launcher.diagVerdict.notStandalone': 'not standalone',
  'launcher.diagVerdict.landscape': 'landscape',
  'launcher.diagVerdict.shortfallTooSmall': 'shortfall too small',
  'launcher.diagVerdict.safeAreaTopZero': 'top=0 (env() stale?)',
  // Nav-bar emulation (#495/#510)
  'launcher.navbar.defaultTitle': 'Mini App',
  'launcher.navbar.back': 'Back',
  'launcher.navbar.menu': 'Menu',
  'launcher.navbar.close': 'Close',
  'launcher.navbar.menuRescan': 'Rescan',
  'launcher.navbar.menuDiag': 'Viewport diagnostics',
  'launcher.navbar.menuLanguage': 'Language',
};
