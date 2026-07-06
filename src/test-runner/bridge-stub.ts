/**
 * Bridge-stub interceptor for env3 blocking-UI SDK calls (devtools#740, DT-2).
 *
 * `--manual-blocking` (devtools#741) lets a human tap through native-UI SDK
 * calls (fullscreen ads, permission dialogs, the save-file share sheet) so
 * their real device behaviour can be captured. That capture (sdk-example
 * run11, 2026-07-05, 2.x/iOS) is the ground truth this module replays: an
 * opt-in interceptor that sits BETWEEN the test bundle and the real native
 * bridge (`window.__sdk`, installed by `src/in-app/auto.ts`) and answers a
 * fixed allowlist of blocking calls with fixture-shaped responses instead of
 * forwarding them to native UI. This lets the SAME manual-tagged test files
 * run unattended, so their assertions (denied-permission error shape,
 * `NO_PERMISSION` envelope, etc.) become part of a CI-checkable contract
 * instead of only ever running with a human present.
 *
 * HONESTY CONTRACT (devtools#740): a stubbed run is NOT env3 in the pure
 * sense — it is a HYBRID cell (real device + real WebView + real bridge
 * transport for every OTHER call, but a synthetic answer for the handful of
 * calls in {@link STUB_REGISTRY}). Every artifact produced under this mode
 * MUST be provenance-stamped (`cell.bridgeStub: true`, see `report.ts`) and
 * MUST NOT be merged into the same file/mode as an unattended baseline run.
 * A stubbed PASS proves "the SDK's rejection/resolution path behaves as
 * fixture-shaped" — it does NOT prove the real native dialog/sheet still
 * looks or behaves a given way on-device. Real behavior re-verification stays
 * on `--manual-blocking` (DT-3) — this module never replaces it, only adds an
 * unattended CHECK on top of what it captured.
 *
 * DRIFT AVOIDANCE: fixtures are frozen snapshots of a real capture. If the
 * native SDK's error shape ever changes, only a fresh `--manual-blocking` run
 * (DT-3) can tell you — this module has no way to detect drift on its own.
 * Treat {@link STUB_REGISTRY} as "last known native truth", not as a
 * specification devtools owns.
 *
 * Runs entirely on the PAGE side (browser-compatible, no Node APIs) — this
 * file is bundled into the injected IIFE by `bundle.ts`'s `sdkRedirectPlugin`,
 * mirroring how `runtime.ts` is bundled. It is imported ONLY from the
 * test-runner (never from `sdk-example/src` — boilerplate cleanliness,
 * umbrella §1.4: this is maintainer/runner infrastructure, not something a
 * mini-app developer's shipped code should carry).
 *
 * SECRET-HANDLING: fixtures below are hand-derived summaries of the captured
 * shapes (see per-entry doc comments citing the source scenario) — no device
 * identifiers, tunnel hosts, relay URLs, or auth codes are embedded anywhere
 * in this file.
 */

/**
 * The exact shape a rejected native bridge call takes on iOS/2.x (and,
 * empirically, unchanged across the manual captures this module replays).
 * Mirrors the `errorKeys` observed in the ground-truth capture:
 * `['name', 'code', 'userInfo', 'moduleName', '__isError']`.
 */
export interface NativeBridgeErrorShape {
  name: string;
  code: string;
  message: string;
  userInfo: Record<string, unknown>;
  moduleName: string;
  __isError: true;
}

/** Builds a {@link NativeBridgeErrorShape}-compatible `Error` instance. */
function makeNativeError(
  code: string,
  message: string,
  moduleName: string,
  userInfo: Record<string, unknown> = {},
): Error & NativeBridgeErrorShape {
  const err = new Error(message) as Error & NativeBridgeErrorShape;
  err.name = 'Error';
  err.code = code;
  err.userInfo = userInfo;
  err.moduleName = moduleName;
  err.__isError = true;
  return err;
}

/**
 * One blocking-call stub entry. `kind` distinguishes the two native calling
 * conventions observed in the mock/real SDK:
 *   - `'promise'` — the call returns a Promise the stub resolves/rejects
 *     (`openPermissionDialog`, `requestPermission`, `saveBase64Data`).
 *   - `'event'` — the call takes `{ onEvent, onError }` callbacks and returns
 *     a cleanup function (`showFullScreenAd`) — the native fullscreen-ad flow
 *     never resolves a Promise; it fires events instead.
 */
export type StubEntry =
  | {
      kind: 'promise';
      /** Pure factory so each call gets a fresh value/error (no shared mutable state). */
      resolve: (args: unknown) => unknown;
    }
  | {
      kind: 'event';
      /**
       * Invoked synchronously with the same `args` the real call would
       * receive; calls `args.onEvent`/`args.onError` per the fixture and
       * returns a no-op cleanup function.
       */
      run: (args: { onEvent: (e: unknown) => void; onError: (e: unknown) => void }) => () => void;
    };

/**
 * Fixture-shaped default responses for the blocking-UI APIs named in
 * devtools#740 as the smallest viable surface: ads `show*`, permissions
 * `openPermissionDialog`/`requestPermission`, storage `saveBase64Data`.
 *
 * Each entry cites the exact `.ait-capture` record (sdk-example run11,
 * 2026-07-05, 2.x/iOS) it was derived from — see the PR body for the full
 * source table. Only the REPRESENTATIVE shape is kept (one success + one
 * native-error per API where the capture contains both); this is a fixed v1
 * default set, not a scenario-selectable registry — see `resolveStubOutcome`
 * for how a test can still opt into the error branch.
 */
export const STUB_REGISTRY: Record<string, StubEntry> = {
  // Source: permissions.2.x.ios.json — scenario "manual-native-dialog-camera"
  // (outcome: resolved, value: 'allowed'). The capture's own resolved value
  // was a bare string, not an object — mirrored verbatim.
  openPermissionDialog: {
    kind: 'promise',
    resolve: () => 'allowed',
  },

  // Source: permissions.2.x.ios.json — scenario
  // "manual-native-request-geolocation" (outcome: rejected, isNativeShape:
  // true, errorCode: 'NO_PERMISSION', errorMessage: 'No permission'). This is
  // the exact envelope DT-2's issue body calls out ("requestPermission→
  // 'denied' 스텁") — the native denial path, not a synthetic message.
  requestPermission: {
    kind: 'promise',
    resolve: () => {
      throw makeNativeError('NO_PERMISSION', 'No permission', 'RNPermissions');
    },
  },

  // Source: storage.2.x.ios.json — scenario "manual-happy-varied-mime-png"
  // (outcome: resolved, returnType: 'undefined') — the real share-sheet call
  // resolves with no value on success.
  saveBase64Data: {
    kind: 'promise',
    resolve: () => undefined,
  },

  // Source: ads.2.x.ios.json — scenario "manual-show" (outcome: rejected,
  // errorCode: '1006', errorMessage: '광고가 로드 중이거나 준비되지 않았습니다').
  // showFullScreenAd never resolves/rejects a Promise on the real bridge — it
  // reports outcomes via onEvent/onError, so the representative capture
  // outcome is replayed as an onError call using the SAME error shape family
  // (isNativeShape: false in the capture — a plain Error, not the
  // name/code/userInfo/moduleName envelope).
  showFullScreenAd: {
    kind: 'event',
    run: (args) => {
      const err = new Error('광고가 로드 중이거나 준비되지 않았습니다') as Error & { code: string };
      err.code = '1006';
      args.onError(err);
      return () => {};
    },
  },
};

/** The allowlisted API names {@link STUB_REGISTRY} can intercept. */
export type StubbableApiName = keyof typeof STUB_REGISTRY;

/**
 * Wraps a `window.__sdk`-shaped bridge object so that calls to any name in
 * {@link STUB_REGISTRY} are answered from the fixture instead of forwarded to
 * `sdk`. Every other property (including non-stubbed functions) passes
 * through UNCHANGED — this is a targeted intercept, not a blanket mock.
 *
 * Returns `sdk` itself, untouched, when `enabled` is false — the exact
 * object identity is preserved so the zero-diff-when-off contract holds even
 * under strict-equality checks in a caller.
 *
 * @param sdk     - The real bridge namespace object (`window.__sdk`).
 * @param enabled - Gate — mirrors the `--stub-blocking` CLI flag /
 *                  `__AIT_STUB_BLOCKING__` page global. Defaults to `false`.
 */
export function wrapSdkWithStub(
  sdk: Record<string, unknown>,
  enabled: boolean,
): Record<string, unknown> {
  if (!enabled) return sdk;

  return new Proxy(sdk, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && Object.hasOwn(STUB_REGISTRY, prop)) {
        return buildStubFunction(prop);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** Builds the callable replacement for a single stubbed API name. */
function buildStubFunction(name: string): (...args: unknown[]) => unknown {
  const entry = STUB_REGISTRY[name];
  if (entry.kind === 'promise') {
    return async (...args: unknown[]) => entry.resolve(args[0]);
  }
  // 'event' kind: (args: { onEvent, onError, ... }) => cleanup
  return (...args: unknown[]) => {
    const callArgs = args[0] as { onEvent: (e: unknown) => void; onError: (e: unknown) => void };
    return entry.run(callArgs);
  };
}

/**
 * Reads the page-global stub-blocking gate. Mirrors the pattern
 * `runtime.ts`/`cell.ts` use for `__AIT_CELL__`/`__AIT_PERMS__` — a plain
 * `globalThis` property injected via `injectGlobals` (Node side, `cell.ts`)
 * BEFORE the first test bundle runs. Absent/false = disabled (default),
 * matching every other opt-in flag in this runner.
 */
export function isStubBlockingEnabled(): boolean {
  return (globalThis as { __AIT_STUB_BLOCKING__?: boolean }).__AIT_STUB_BLOCKING__ === true;
}
