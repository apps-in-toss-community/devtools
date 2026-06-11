/**
 * shim-composition.test.ts
 *
 * polyfill×mock 합성 경로 e2e — sdk-example ShimCompositionCard 제거(sdk-example#177)로
 * 사라진 커버리지 이관.
 *
 * 검증 대상: devtools mock 활성 시 @ait-co/polyfill 이 @apps-in-toss/web-framework
 * (= mock alias)를 "toss 환경"으로 감지해 표준 Web API 호출을 mock 경유로 라우팅하는
 * mock-via-polyfill 합성 경로.
 *
 * 합성 메커니즘:
 * 1. fixture vite.config.ts의 resolve.alias가 @apps-in-toss/web-framework를 dist/mock/index.js로 매핑
 * 2. @ait-co/polyfill/auto가 install() 호출 → navigator.clipboard를 shim으로 교체
 * 3. polyfill shim의 writeText가 isTossEnvironment()를 호출 — mock의 getAppsInTossGlobals()가
 *    정상 객체를 반환하므로 "toss 환경" true
 * 4. shim이 SDK(= mock)의 setClipboardText를 호출 → window.__ait.state.mockData.clipboardText 갱신
 */

import { expect, test } from '@playwright/test';

test.use({
  permissions: ['clipboard-read', 'clipboard-write'],
});

test('shim-composition: polyfill clipboard shim이 설치되어 navigator.clipboard가 교체된다', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // polyfill clipboard shim은 Symbol.for('@ait-co/polyfill/clipboard.original') 키를
  // navigator에 부착한다(installClipboardShim). 이 키가 존재하면 shim이 설치된 것이다.
  const shimInstalled = await page.evaluate(() => {
    const backupKey = Symbol.for('@ait-co/polyfill/clipboard.original');
    return backupKey in (navigator as unknown as Record<symbol, unknown>);
  });

  expect(shimInstalled, 'polyfill clipboard shim should be installed on navigator').toBe(true);
});

test('shim-composition: writeText round-trip이 devtools mock state(mockData.clipboardText)를 갱신한다', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // polyfill isTossEnvironment() 감지 완료를 보장하기 위해 networkidle 후 evaluate.
  // polyfill shim의 writeText → isTossEnvironment() → mock SDK getAppsInTossGlobals() probe
  // → "toss 환경" true → mock setClipboardText 경유 → window.__ait.state 갱신 경로.
  const result = await page.evaluate(async () => {
    const probe = 'probe';

    // navigator.clipboard.writeText 호출 — polyfill shim을 통해 mock SDK로 라우팅
    await navigator.clipboard.writeText(probe);

    // window.__ait.state.mockData.clipboardText 확인
    const ait = (
      window as unknown as { __ait?: { state?: { mockData?: { clipboardText?: string } } } }
    ).__ait;
    const actual = ait?.state?.mockData?.clipboardText;
    return {
      actual,
      matched: actual === probe,
    };
  });

  expect(result.matched, `devtools mockData.clipboardText === probe (got: ${result.actual})`).toBe(
    true,
  );
});
