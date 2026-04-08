/**
 * Floating Panel CSS (inline, 외부 의존성 없음)
 */

export const PANEL_STYLES = /* css */ `
  .ait-panel-toggle {
    position: fixed;
    bottom: 16px;
    right: 16px;
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
  }
  .ait-panel-toggle:hover {
    transform: scale(1.1);
  }

  .ait-panel {
    position: fixed;
    bottom: 72px;
    right: 16px;
    z-index: 99998;
    width: 360px;
    max-height: 520px;
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
  .ait-panel-header span {
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
    max-height: 400px;
    flex: 1;
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
`;
