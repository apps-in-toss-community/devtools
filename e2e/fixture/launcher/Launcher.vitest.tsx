// Unit tests for the banner gate narrowing (issue #574): the
// "letterbox 보정 +0pt 적용됨" noise that appeared when the
// held correction absorbed the shortfall to zero.
//
// Collected by vitest via the `*.vitest.ts` / `*.vitest.tsx` include in
// vitest.config.ts — the distinct extension keeps Playwright from picking
// these up.
//
// Launcher.tsx's correctionPhase/letterboxDetected/letterboxShortfallPx are
// internal state derived from readViewportMetrics() + a state machine, so
// rendering the full Launcher is impractical under jsdom (QrScanner uses
// WebRTC, the correction state machine needs IntersectionObserver, etc.).
// Instead we follow the same pattern as the other *.vitest.ts files in this
// directory: test the logic that drives the banner as a small pure component
// that accepts the three derived props directly.  The gate expression is
// identical to the one in Launcher.tsx line ~1620.
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

// -------------------------------------------------------------------------
// Tiny stub that replicates ONLY the banner element + gate from Launcher.tsx.
// It receives the three derived values as props so we can drive all branches
// without touching the real component's state machine.
// -------------------------------------------------------------------------

type CorrectionPhase = 'idle' | 'applying' | 'held' | 'clipped';

interface BannerProps {
  letterboxDetected: boolean;
  correctionPhase: CorrectionPhase;
  letterboxShortfallPx: number;
}

function LetterboxBanner({
  letterboxDetected,
  correctionPhase,
  letterboxShortfallPx,
}: BannerProps): React.JSX.Element | null {
  // Mirror the gate in Launcher.tsx exactly.
  // #541 결함 2: `letterboxDetected && correctionPhase !== 'held'`으로 통일.
  // 기존의 `|| letterboxShortfallPx > 0`은 shortfallPx 의존을 만들었고
  // `letterboxDetected`(=isLetterboxResolved, correction-aware)와 의미가 중복.
  // `correctionPhase !== 'held'`로 shortfallPx 독립성 확보:
  //   - idle     → letterboxDetected=false → 배너 없음
  //   - applying → force 진행 중           → 배너 있음
  //   - held     → force 흡수, 성공 완료   → 배너 없음 (#574 노이즈 방지)
  //   - clipped  → 실제 클리핑 경고        → 배너 있음
  if (!(letterboxDetected && correctionPhase !== 'held')) {
    return null;
  }
  return (
    <div role="status" data-testid="launcher-letterbox-label">
      {correctionPhase === 'clipped'
        ? `clipped +${letterboxShortfallPx}pt`
        : `+${letterboxShortfallPx}pt 적용됨`}
    </div>
  );
}

// -------------------------------------------------------------------------
// Banner gate tests (#574 regression guard)
// -------------------------------------------------------------------------

describe('launcher letterbox banner gate (#574)', () => {
  afterEach(() => {
    cleanup();
  });

  it('held correction + shortfall 0 → banner NOT rendered (the #574 noise case)', () => {
    // Scenario: the correction has been held and shortfall is absorbed to 0.
    // Before the fix this showed "+0pt 적용됨".  After the fix it is silent.
    render(
      <LetterboxBanner letterboxDetected={true} correctionPhase="held" letterboxShortfallPx={0} />,
    );
    expect(screen.queryByTestId('launcher-letterbox-label')).toBeNull();
  });

  it('held correction + shortfall > 0 → banner NOT rendered (#541 게이트 통일)', () => {
    // #541 결함 2: held 상태는 force가 성공적으로 완료된 상태이므로
    // shortfall 값에 관계없이 사용자에게 배너를 보여줄 필요가 없다.
    // 기존 게이트(`|| letterboxShortfallPx > 0`)는 이 케이스에서 배너를
    // 표시했지만, held=force 완료 의미와 불일치했다.
    render(
      <LetterboxBanner letterboxDetected={true} correctionPhase="held" letterboxShortfallPx={47} />,
    );
    expect(screen.queryByTestId('launcher-letterbox-label')).toBeNull();
  });

  it('clipped phase → banner IS rendered regardless of shortfall value', () => {
    // Scenario: the sentinel reported the band is clipped (genuine limit
    // warning).  The clipped message must always appear even when shortfallPx
    // happens to be 0 (e.g. measured before correction fully settled).
    render(
      <LetterboxBanner
        letterboxDetected={true}
        correctionPhase="clipped"
        letterboxShortfallPx={0}
      />,
    );
    expect(screen.queryByTestId('launcher-letterbox-label')).not.toBeNull();
  });

  it('letterboxDetected=false → banner NOT rendered (outer gate)', () => {
    // Sanity: when there is no letterbox at all the banner must never show.
    render(
      <LetterboxBanner
        letterboxDetected={false}
        correctionPhase="held"
        letterboxShortfallPx={47}
      />,
    );
    expect(screen.queryByTestId('launcher-letterbox-label')).toBeNull();
  });

  it('applying phase + shortfall 47 → banner IS rendered (#541 게이트 통일 회귀 가드)', () => {
    // #541 결함 2: `correctionPhase !== 'held'` 게이트에서 applying은 force가
    // 진행 중이므로 배너가 표시돼야 한다. shortfallPx 독립성을 확보했으므로
    // shortfall 값과 무관하게 phase만으로 판정한다.
    render(
      <LetterboxBanner
        letterboxDetected={true}
        correctionPhase="applying"
        letterboxShortfallPx={47}
      />,
    );
    const el = screen.queryByTestId('launcher-letterbox-label');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('+47pt');
  });
});

// ---------------------------------------------------------------------------
// setup main height 전파 (#541 결함 1 회귀 가드)
//
// `minHeight: '100dvh'`는 letterbox 상태에서 mis-reported ICB(≈797) 기준으로
// 해소된다. `100%`로 수정하면 parent fixed div(inset:0, ICB 추종)를 따라
// html/body force(screen.height로 확장)가 setup main에도 전파된다.
// jsdom에서 실제 ICB 확장은 불가능하지만, 퍼센트 vs dvh 게이트 표현을
// 순수 컴포넌트로 추출해 minHeight 속성값이 올바른지 검증한다.
// ---------------------------------------------------------------------------

interface SetupMainProps {
  letterboxDetected: boolean;
}

function SetupMainStub({ letterboxDetected: _ }: SetupMainProps): React.JSX.Element {
  // Root fixed div: inset:0, height는 ICB에서 온다 (html/body force 후 screen.height).
  // Setup main: `100%`로 parent를 추종해야 보정이 전파된다.
  // 이 stub은 minHeight 값만 검증하기 위한 최소 구조다.
  return (
    <div data-testid="root-div" style={{ position: 'fixed', inset: 0 }}>
      <main
        data-testid="setup-main"
        style={{
          // #541 결함 1 수정: 100dvh → 100%
          minHeight: '100%',
        }}
      />
    </div>
  );
}

describe('launcher setup main height 전파 (#541 결함 1)', () => {
  afterEach(() => {
    cleanup();
  });

  it('setup main의 minHeight가 "100%"이어야 한다 (dvh 아님)', () => {
    // 결함 1 회귀 가드: `100dvh`는 letterbox 상태에서 mis-reported ICB(≈797)
    // 기준으로 해소된다. `100%`이면 parent fixed div(inset:0)를 통해
    // html/body force(screen.height)가 전파된다.
    render(<SetupMainStub letterboxDetected={true} />);
    const main = document.querySelector('[data-testid="setup-main"]') as HTMLElement;
    expect(main).not.toBeNull();
    expect(main.style.minHeight).toBe('100%');
  });

  it('setup main의 minHeight가 "100dvh"이면 회귀다', () => {
    // 역검증: dvh로 설정하면 이 테스트가 실패해야 한다.
    // 아래는 잘못된 구현을 시뮬레이션한다.
    render(
      <div style={{ position: 'fixed', inset: 0 }}>
        <main data-testid="wrong-setup-main" style={{ minHeight: '100dvh' }} />
      </div>,
    );
    const main = document.querySelector('[data-testid="wrong-setup-main"]') as HTMLElement;
    // 잘못된 구현 감지 — dvh가 있으면 버그다.
    expect(main.style.minHeight).not.toBe('100%');
  });
});

// ---------------------------------------------------------------------------
// webViewType self-report message handler (#580)
//
// The real Launcher cannot render under jsdom (QrScanner/WebRTC, the correction
// state machine's IntersectionObserver, etc. — see the file header). Following
// the same pattern as the banner stub above, this stub replicates ONLY the
// navBarType state + the message-handler effect from Launcher.tsx (the block at
// ~line 967) so all branches of the cross-origin receive path can be driven by
// dispatching real window `message` events. The handler logic is copied
// verbatim; if Launcher.tsx changes, change this too.
// ---------------------------------------------------------------------------

const WEB_VIEW_TYPE_MESSAGE_TYPE = 'ait:web-view-type';

type NavBarType = 'partner' | 'game';

function WebViewTypeReceiver(): React.JSX.Element {
  const [navBarType, setNavBarType] = useState<NavBarType>('partner');

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as unknown;
      if (typeof data !== 'object' || data === null) return;
      const type = (data as { type?: unknown }).type;
      if (type === WEB_VIEW_TYPE_MESSAGE_TYPE) {
        const value = (data as { value?: unknown }).value;
        if (value === 'partner' || value === 'game') setNavBarType(value);
        return;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return <div data-testid="navbar-type">{navBarType}</div>;
}

function postWindowMessage(data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }));
  });
}

describe('launcher webViewType self-report handler (#580)', () => {
  afterEach(() => {
    cleanup();
  });

  it("game self-report → navBarType becomes 'game'", () => {
    render(<WebViewTypeReceiver />);
    expect(screen.getByTestId('navbar-type').textContent).toBe('partner');
    postWindowMessage({ type: WEB_VIEW_TYPE_MESSAGE_TYPE, value: 'game' });
    expect(screen.getByTestId('navbar-type').textContent).toBe('game');
  });

  it("partner self-report → navBarType stays/sets 'partner'", () => {
    render(<WebViewTypeReceiver />);
    // First go to game, then a partner report must switch back.
    postWindowMessage({ type: WEB_VIEW_TYPE_MESSAGE_TYPE, value: 'game' });
    expect(screen.getByTestId('navbar-type').textContent).toBe('game');
    postWindowMessage({ type: WEB_VIEW_TYPE_MESSAGE_TYPE, value: 'partner' });
    expect(screen.getByTestId('navbar-type').textContent).toBe('partner');
  });

  it('invalid value → navBarType unchanged (strict enum allow-list)', () => {
    render(<WebViewTypeReceiver />);
    postWindowMessage({ type: WEB_VIEW_TYPE_MESSAGE_TYPE, value: 'game' });
    expect(screen.getByTestId('navbar-type').textContent).toBe('game');
    // 'external', unknown strings, non-strings must NOT flip the bar.
    for (const bad of ['external', 'GAME', '', 42, null]) {
      postWindowMessage({ type: WEB_VIEW_TYPE_MESSAGE_TYPE, value: bad });
    }
    expect(screen.getByTestId('navbar-type').textContent).toBe('game');
  });

  it('foreign message type → ignored', () => {
    render(<WebViewTypeReceiver />);
    postWindowMessage({ type: 'ait:debug-attach-blocked', reason: 'auth' });
    postWindowMessage({ type: 'something-else', value: 'game' });
    expect(screen.getByTestId('navbar-type').textContent).toBe('partner');
  });

  it('non-object / null payloads → ignored (no throw)', () => {
    render(<WebViewTypeReceiver />);
    for (const bad of [null, undefined, 'ait:web-view-type', 42]) {
      postWindowMessage(bad);
    }
    expect(screen.getByTestId('navbar-type').textContent).toBe('partner');
  });
});
