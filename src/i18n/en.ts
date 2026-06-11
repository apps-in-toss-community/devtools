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

  // Consent toast
  'toast.consent.title': 'Send anonymous usage stats?',
  'toast.consent.body':
    'We collect anonymous events only, to improve the tool. You can turn this off anytime in the Environment tab.',
  'toast.consent.learnMore': 'Learn more',
  'toast.consent.accept': 'Yes, send',
  'toast.consent.deny': 'No, thanks',

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

  // Environment > Telemetry section
  'env.telemetry.section': 'Telemetry',
  // Tier 0 — opt-out anonymous signal
  'env.telemetry.t0Row': 'Anonymous usage signal (Tier 0)',
  'env.telemetry.t0On': 'On',
  'env.telemetry.t0Off': 'Off',
  'env.telemetry.t0TurnOn': 'Turn on',
  'env.telemetry.t0TurnOff': 'Turn off',
  'env.telemetry.t0Desc': 'Version + date only, no PII. Once per day. Helps improve the package.',
  // Tier 1 — opt-in extended telemetry
  'env.telemetry.row': 'Extended telemetry (Tier 1)',
  'env.telemetry.on': 'On',
  'env.telemetry.off': 'Off',
  'env.telemetry.turnOn': 'Turn on',
  'env.telemetry.turnOff': 'Turn off',
  'env.telemetry.anonIdLabel': 'anon_id: {value}',
  'env.telemetry.anonIdNotSet': '(not yet set)',
  'env.telemetry.anonIdCopyTitle': 'Click to copy full anon_id',
  'env.telemetry.deleteBtn': 'Delete my data',
  'env.telemetry.deleting': 'Deleting…',
  'env.telemetry.deleted': 'Deleted',
  'env.telemetry.deleteFailedRetry': 'Delete failed (please retry)',
  'env.telemetry.deleteFailed': 'Delete failed',
  'env.telemetry.privacyLink': 'Privacy policy →',

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
  'dashboard.attach.hint': 'Call the build_attach_url MCP tool to show the QR here.',
  'dashboard.pages.section': 'Connected Pages',
  'dashboard.pages.empty': 'No attached pages',

  // qr-http-server — url-box copy button
  'dashboard.url.copy': 'Copy',
  'dashboard.url.copied': 'Copied',

  // qr-http-server — inspector open link (#503)
  'dashboard.inspector.section': 'Inspector',
  'dashboard.inspector.open': 'Open inspector',
  'dashboard.inspector.waiting': 'Inspector URL pending — appears after a page attaches',

  // qr-http-server — attach page (server-side, Node, per-request)
  // Copy branches per session mode into sandbox (env 2) / intoss (env 3·4) families (#468).
  'attach.title': 'AIT Debug Session — QR Scan',
  'attach.deployment': 'deployment: {label}',
  'attach.steps.section': 'How to scan',
  'attach.faq.section': 'Troubleshooting checklist',
  'attach.url.section': 'URL (fallback)',

  // qr-http-server — attach page mode label (environment visibility, #468)
  'attach.mode.sandbox': 'Env 2 — AITC Sandbox PWA',
  'attach.mode.intossDev': 'Env 3 — intoss-private relay dev',
  'attach.mode.intossLive': 'Env 4 — intoss live relay debug',

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
  'attach.sandbox.faq.totp': '<strong>QR expired (TOTP ~3 min)</strong> — scan a fresh QR code',
  'attach.sandbox.faq.chii':
    '<strong>Chii injection failure / console is empty</strong> — verify the mini-app bundle has an <code>in-app</code> debug import',

  // attach page — intoss family (env 3·4: Toss app deep-link)
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
  // env 4 (relay-live) only — appended to the intoss family at runtime (#468).
  'attach.intoss.faq.liveReadOnly':
    '<strong>LIVE session is read-only</strong> — <code>call_sdk</code>/<code>evaluate</code> require an explicit <code>confirm</code>',

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
    'Display area is {pt}pt short — likely an iOS standalone letterbox. Removing and re-adding the launcher to the home screen may fix it.',
  // Nav-bar emulation (#495/#510)
  'launcher.navbar.defaultTitle': 'Mini App',
  'launcher.navbar.back': 'Back',
  'launcher.navbar.menu': 'Menu',
  'launcher.navbar.close': 'Close',
  'launcher.navbar.menuRescan': 'Rescan',
  'launcher.navbar.menuDiag': 'Viewport diagnostics',
  'launcher.navbar.menuLanguage': 'Language',
};
