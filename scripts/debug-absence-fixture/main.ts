// Minimal release-consumer reference for the build-time absence guard (#647).
//
// This is NOT a panel/mock fixture — it is the smallest possible consumer that
// imports the in-app debug surface the way a real mini-app does: a dynamic
// `import('@ait-co/devtools/in-app')` guarded by `if (__DEBUG_BUILD__)`. The
// guard is the only thing under test, so this file deliberately avoids the
// e2e panel fixture's mock/panel self-alias graph (which has its own chunking
// behaviour unrelated to DCE).
//
// scripts/check-debug-surface-absent.sh builds this in two modes:
//   - release (AIT_DEBUG_BUILD unset → __DEBUG_BUILD__ false): the whole
//     `import('@ait-co/devtools/in-app')` graph — Chii target.js injection AND
//     the eruda console it pulls in — must DCE to 0 bytes.
//   - debug (AIT_DEBUG_BUILD=1 → true): the surface must survive (positive
//     control), and the inner runtime gate (debug=1 + relay + Layer B/C TOTP
//     in maybeAttach) still applies.
if (__DEBUG_BUILD__ && typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === '1' && params.get('relay')) {
    import('@ait-co/devtools/in-app').then(({ maybeAttach }) => {
      maybeAttach();
    });
  }
}
