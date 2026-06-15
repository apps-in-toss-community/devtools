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
  // Mirror the gate at Launcher.tsx line ~1620 exactly.
  if (!(letterboxDetected && (correctionPhase === 'clipped' || letterboxShortfallPx > 0))) {
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

  it('held correction + shortfall > 0 → banner IS rendered with the pt value', () => {
    // Scenario: there is a genuine non-zero correction being held (e.g. +47pt).
    render(
      <LetterboxBanner letterboxDetected={true} correctionPhase="held" letterboxShortfallPx={47} />,
    );
    const el = screen.queryByTestId('launcher-letterbox-label');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('+47pt');
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
