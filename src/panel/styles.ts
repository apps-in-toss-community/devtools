/**
 * Floating Panel CSS (inline, 외부 의존성 없음)
 */

export const PANEL_WIDTH = 360;
export const PANEL_HEIGHT = 480;
export const PANEL_FULLSCREEN_BREAKPOINT = 720;

// Viewport simulation frame styling
export const VIEWPORT_FRAME_BORDER_RADIUS = 36;
export const VIEWPORT_FRAME_BEZEL_INNER = 10; // first ring (outer device shell)
export const VIEWPORT_FRAME_BEZEL_OUTER = 12; // second ring (chrome highlight)
export const VIEWPORT_FRAME_BEZEL_COLOR_INNER = '#1a1a2e';
export const VIEWPORT_FRAME_BEZEL_COLOR_OUTER = '#3a3a5a';
export const VIEWPORT_BG_COLOR = '#0a0a14';
export const VIEWPORT_BODY_MARGIN = 24;

export const PANEL_STYLES = /* css */ `
  .ait-panel-toggle {
    position: fixed;
    z-index: 99999;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #3182F6;
    border: none;
    cursor: pointer;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: white;
    transition: transform 0.15s;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    touch-action: none;
    user-select: none;
  }
  .ait-panel-toggle:hover:not(.dragging) {
    transform: scale(1.1);
  }

  .ait-panel {
    position: fixed;
    z-index: 99998;
    width: ${PANEL_WIDTH}px;
    height: ${PANEL_HEIGHT}px;
    background: #1a1a2e;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', sans-serif;
    font-size: 13px;
    color: #e0e0e0;
    overflow: hidden;
    display: none;
  }
  .ait-panel.open {
    display: flex;
    flex-direction: column;
  }

  .ait-panel-header {
    padding: 12px 16px;
    background: #16213e;
    font-weight: 600;
    font-size: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #2a2a4a;
  }
  .ait-panel-header > span:first-child {
    color: #3182F6;
  }

  .ait-panel-tabs {
    display: flex;
    background: #16213e;
    border-bottom: 1px solid #2a2a4a;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .ait-panel-tabs::-webkit-scrollbar { display: none; }

  .ait-panel-tab {
    padding: 8px 12px;
    font-size: 12px;
    color: #888;
    cursor: pointer;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    background: none;
    border-top: none;
    border-left: none;
    border-right: none;
    font-family: inherit;
  }
  .ait-panel-tab:hover {
    color: #bbb;
  }
  .ait-panel-tab.active {
    color: #3182F6;
    border-bottom-color: #3182F6;
  }

  .ait-panel-body {
    padding: 12px 16px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .ait-section {
    margin-bottom: 16px;
  }
  .ait-section-title {
    font-size: 11px;
    text-transform: uppercase;
    color: #666;
    margin-bottom: 8px;
    letter-spacing: 0.5px;
  }

  .ait-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .ait-row label {
    color: #aaa;
    font-size: 12px;
  }

  .ait-select {
    background: #2a2a4a;
    color: #e0e0e0;
    border: 1px solid #3a3a5a;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
  }

  .ait-input {
    background: #2a2a4a;
    color: #e0e0e0;
    border: 1px solid #3a3a5a;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    width: 100px;
    font-family: inherit;
  }

  .ait-btn {
    background: #3182F6;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .ait-btn:hover {
    background: #1b6ef3;
  }
  .ait-btn-sm {
    padding: 4px 8px;
    font-size: 11px;
  }
  .ait-btn-danger {
    background: #e74c3c;
  }
  .ait-btn-danger:hover {
    background: #c0392b;
  }

  .ait-log-entry {
    font-family: 'SF Mono', 'Menlo', monospace;
    font-size: 11px;
    padding: 3px 0;
    border-bottom: 1px solid #2a2a4a;
    color: #aaa;
  }
  .ait-log-entry .ait-log-type {
    color: #3182F6;
    font-weight: 600;
    margin-right: 6px;
  }
  .ait-log-entry .ait-log-time {
    color: #555;
    margin-right: 6px;
  }

  .ait-storage-row {
    font-family: 'SF Mono', 'Menlo', monospace;
    font-size: 11px;
    display: flex;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid #2a2a4a;
  }
  .ait-storage-key {
    color: #e8a87c;
    min-width: 80px;
    word-break: break-all;
  }
  .ait-storage-value {
    color: #95e6cb;
    flex: 1;
    word-break: break-all;
  }

  /* Device tab */
  .ait-image-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .ait-image-thumb {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid #3a3a5a;
  }
  .ait-image-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .ait-image-thumb .ait-image-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: rgba(231,76,60,0.9);
    color: white;
    border: none;
    cursor: pointer;
    font-size: 10px;
    line-height: 18px;
    text-align: center;
    padding: 0;
  }
  .ait-btn-row {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .ait-btn-secondary {
    background: #2a2a4a;
    color: #e0e0e0;
    border: 1px solid #3a3a5a;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
  }
  .ait-btn-secondary:hover {
    background: #3a3a5a;
  }

  /* Prompt notification */
  .ait-prompt-banner {
    background: #2d1b69;
    border: 1px solid #6c3bd5;
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .ait-prompt-banner .ait-prompt-title {
    color: #b388ff;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .ait-prompt-input-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 6px;
  }
  .ait-prompt-input-row input {
    background: #2a2a4a;
    color: #e0e0e0;
    border: 1px solid #3a3a5a;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    width: 80px;
    font-family: inherit;
  }
  .ait-prompt-input-row label {
    color: #aaa;
    font-size: 11px;
    min-width: 30px;
  }

  .ait-panel-close {
    display: none;
    background: none;
    border: none;
    color: #888;
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    font-family: inherit;
  }
  .ait-panel-close:hover {
    color: #e0e0e0;
  }

  /* Disabled state for monitoring-only mode */
  .ait-select:disabled,
  .ait-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ait-btn:disabled,
  .ait-btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ait-btn-danger:disabled {
    background: #5a5a5a;
  }

  /* Mock status badge */
  .ait-mock-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.3px;
    cursor: pointer;
  }
  .ait-mock-badge-on {
    background: #1a4731;
    color: #4ade80;
  }
  .ait-mock-badge-off {
    background: #4a1a1a;
    color: #f87171;
  }

  /* Monitoring-only notice */
  .ait-monitoring-notice {
    background: #2a1a00;
    border: 1px solid #6b4c00;
    border-radius: 4px;
    padding: 6px 10px;
    margin-bottom: 12px;
    font-size: 11px;
    color: #fbbf24;
  }

  .ait-panel-tab-error {
    padding: 12px;
    color: #e53e3e; /* readable on both light (#fff) and dark (#1a1a2e) panel backgrounds */
  }

  /* Viewport tab status rows */
  .ait-status-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 11px;
    color: #888;
    padding: 3px 0;
    border-bottom: 1px dashed #2a2a4a;
    gap: 8px;
  }
  .ait-status-row:last-child { border-bottom: none; }
  .ait-status-row .ait-status-value {
    font-family: 'SF Mono', 'Menlo', monospace;
    color: #95e6cb;
    font-size: 11px;
    text-align: right;
    word-break: break-word;
  }

  /* === Viewport simulation === */
  /* Static rules. Dynamic per-preset values (width/height, navbar top offset)
     are still injected via a separate <style id="__ait-viewport-style">. */
  html.ait-viewport-active {
    background: ${VIEWPORT_BG_COLOR};
    min-height: 100dvh;
  }
  html.ait-viewport-active body {
    position: relative;
    /* isolation: isolate creates a stacking context so notch/navbar z-index
       cannot escape body and paint over the floating Panel toggle. */
    isolation: isolate;
    margin: ${VIEWPORT_BODY_MARGIN}px auto;
    overflow: auto;
    background: #fff;
    box-sizing: border-box;
  }
  html.ait-viewport-framed body {
    border-radius: ${VIEWPORT_FRAME_BORDER_RADIUS}px;
    box-shadow:
      0 0 0 ${VIEWPORT_FRAME_BEZEL_INNER}px ${VIEWPORT_FRAME_BEZEL_COLOR_INNER},
      0 0 0 ${VIEWPORT_FRAME_BEZEL_OUTER}px ${VIEWPORT_FRAME_BEZEL_COLOR_OUTER},
      0 24px 48px rgba(0,0,0,0.5);
  }

  /* Notch / Dynamic Island / punch-hole overlay (top of body) */
  .ait-notch {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    background: #000;
    z-index: 10;
    pointer-events: none;
  }
  .ait-notch-dynamic-island { top: 11px; width: 126px; height: 37px; border-radius: 20px; }
  .ait-notch-pill {
    width: 160px; height: 30px;
    border-bottom-left-radius: 20px; border-bottom-right-radius: 20px;
  }
  .ait-notch-punch-hole { top: 10px; width: 12px; height: 12px; border-radius: 50%; }

  /* Home indicator pill (bottom of body, iPhones with safe-area bottom > 0) */
  .ait-home-indicator {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    width: 134px;
    height: 5px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.85);
    z-index: 10;
    pointer-events: none;
  }

  /* Apps in Toss host nav bar — sits directly below the OS status bar */
  .ait-navbar {
    position: absolute;
    left: 0;
    right: 0;
    height: 48px; /* AIT_NAV_BAR_HEIGHT */
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    box-sizing: border-box;
    font: 500 15px -apple-system, BlinkMacSystemFont, 'Pretendard', sans-serif;
    color: #1a1a1a;
    z-index: 10;
  }
  .ait-navbar-title {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    margin-left: 4px;
    overflow: hidden;
  }
  .ait-navbar-icon {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: linear-gradient(135deg, #3182f6, #7c3aed);
    flex-shrink: 0;
  }
  .ait-navbar-name {
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ait-navbar-actions {
    display: flex;
    align-items: center;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 999px;
    padding: 4px 8px;
    gap: 4px;
  }
  .ait-navbar-btn {
    background: none;
    border: none;
    padding: 2px 8px;
    font: inherit;
    font-size: 18px;
    color: inherit;
    line-height: 1;
    cursor: pointer;
  }
  .ait-navbar-btn:hover { color: #3182f6; }
  .ait-navbar-back { padding: 0 8px; font-size: 24px; }
  .ait-navbar-divider { width: 1px; height: 16px; background: rgba(0, 0, 0, 0.15); }

  /* Game variant: 투명 배경, 우측 actions만 — 풀스크린 게임 캔버스를 가리지 않는다 */
  .ait-navbar.ait-navbar-game {
    background: transparent;
    backdrop-filter: none;
    justify-content: flex-end;
    color: #fff;
  }
  .ait-navbar.ait-navbar-game .ait-navbar-actions {
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
  }
  .ait-navbar.ait-navbar-game .ait-navbar-divider {
    background: rgba(255, 255, 255, 0.3);
  }
  .ait-navbar.ait-navbar-game .ait-navbar-btn:hover { color: #8ab4ff; }

  @media (max-width: ${PANEL_FULLSCREEN_BREAKPOINT}px) {
    .ait-panel.open {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      max-height: 100%;
      border-radius: 0;
    }
    .ait-panel-toggle {
      z-index: 100000;
    }
    .ait-panel-close {
      display: block;
    }
  }
`;
