/**
 * MCP 에러 메시지 품질 일관화 — 4상태 차별화 + Tier 거부 통일 테스트 (#285).
 *
 * 검증 항목:
 *   - mcpError(): isError: true + 단일 text content block
 *   - tunnelDownError(): 터널 미가동 한국어 메시지
 *   - pageMissingError(): 페이지 미attach 한국어 메시지 + build_attach_url 안내
 *   - pageCrashError(): 페이지 crash 한국어 메시지 + 재attach 안내
 *   - sdkAbsentError(): SDK 부재 한국어 메시지 + dogfood 채널 안내
 *   - relayDisconnectError(): relay 연결 끊김 한국어 메시지
 *   - tierRejectionError(): Tier 거부 — 한국어 + 하위 호환 영문 패턴 포함
 *   - classifyToolError(): 에러 메시지 패턴으로 4상태 자동 분류
 */
import { describe, expect, it } from 'vitest';
import {
  classifyToolError,
  mcpError,
  pageCrashError,
  pageMissingError,
  relayDisconnectError,
  sdkAbsentError,
  tierRejectionError,
  tunnelDownError,
} from '../errors.js';

// ---------- 공통 헬퍼 ----------

function getText(result: ReturnType<typeof mcpError>): string {
  return result.content[0]?.text ?? '';
}

// ---------- mcpError ----------

describe('mcpError', () => {
  it('sets isError: true', () => {
    const result = mcpError('something went wrong');
    expect(result.isError).toBe(true);
  });

  it('returns a single text content block', () => {
    const result = mcpError('msg');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toBe('msg');
  });
});

// ---------- 4상태 차별화 메시지 ----------

describe('tunnelDownError — 상태 1: tunnel 미가동', () => {
  it('포함: "터널"', () => {
    expect(getText(tunnelDownError())).toContain('터널');
  });

  it('포함: "list_pages" (다음 행동 안내)', () => {
    expect(getText(tunnelDownError())).toContain('list_pages');
  });

  it('isError: true', () => {
    expect(tunnelDownError().isError).toBe(true);
  });
});

describe('pageMissingError — 상태 2: page 미attach', () => {
  it('포함: "attach" (원인)', () => {
    expect(getText(pageMissingError())).toContain('attach');
  });

  it('포함: "build_attach_url" (다음 행동 안내)', () => {
    expect(getText(pageMissingError())).toContain('build_attach_url');
  });

  it('toolName 있으면 prefix에 포함', () => {
    expect(getText(pageMissingError('list_console_messages'))).toContain('list_console_messages');
  });

  it('isError: true', () => {
    expect(pageMissingError().isError).toBe(true);
  });
});

describe('pageCrashError — 상태 3: page crash', () => {
  it('포함: "crash" (원인)', () => {
    expect(getText(pageCrashError())).toContain('crash');
  });

  it('포함: "재attach" 또는 "build_attach_url" (다음 행동 안내)', () => {
    const text = getText(pageCrashError());
    expect(text.includes('재attach') || text.includes('build_attach_url')).toBe(true);
  });

  it('toolName 있으면 prefix에 포함', () => {
    expect(getText(pageCrashError('take_screenshot'))).toContain('take_screenshot');
  });

  it('isError: true', () => {
    expect(pageCrashError().isError).toBe(true);
  });
});

describe('sdkAbsentError — 상태 4: SDK 부재', () => {
  it('포함: "window.__sdkCall" (원인)', () => {
    expect(getText(sdkAbsentError())).toContain('window.__sdkCall');
  });

  it('포함: "dogfood" (다음 행동 안내)', () => {
    expect(getText(sdkAbsentError())).toContain('dogfood');
  });

  it('toolName 있으면 prefix에 포함', () => {
    expect(getText(sdkAbsentError('call_sdk'))).toContain('call_sdk');
  });

  it('isError: true', () => {
    expect(sdkAbsentError().isError).toBe(true);
  });
});

describe('relayDisconnectError — relay 연결 끊김', () => {
  it('포함: "relay" (원인)', () => {
    expect(getText(relayDisconnectError())).toContain('relay');
  });

  it('포함: "list_pages" (다음 행동 안내)', () => {
    expect(getText(relayDisconnectError())).toContain('list_pages');
  });

  it('isError: true', () => {
    expect(relayDisconnectError().isError).toBe(true);
  });
});

// ---------- Tier 거부 메시지 ----------

describe('tierRejectionError — Tier A/B 환경 불일치', () => {
  it('한국어 원인 메시지 포함', () => {
    const text = getText(tierRejectionError('build_attach_url', 'relay', 'mock', 'default-mock'));
    expect(text).toContain('build_attach_url');
    expect(text).toContain('relay');
  });

  it('하위 호환 영문 패턴 포함 (기존 테스트 어서션 유지)', () => {
    const text = getText(tierRejectionError('build_attach_url', 'relay', 'mock', 'default-mock'));
    expect(text).toContain('available only in relay');
    expect(text).toContain('Current environment is mock');
  });

  it('relay 환경 필요 → build_attach_url hint 포함', () => {
    const text = getText(tierRejectionError('build_attach_url', 'relay', 'mock', 'env-var-mock'));
    expect(text).toContain('build_attach_url');
  });

  it('isError: true', () => {
    expect(tierRejectionError('build_attach_url', 'relay', 'mock', 'default-mock').isError).toBe(
      true,
    );
  });
});

// ---------- classifyToolError: 자동 분류 ----------

describe('classifyToolError — 에러 패턴 자동 분류', () => {
  it('tunnel-down: 접두사 → tunnelDownError 메시지', () => {
    const err = new Error('tunnel-down: 터널이 안 떠 있습니다. 서버를 재시작하세요.');
    const result = classifyToolError(err, 'build_attach_url');
    expect(getText(result)).toContain('터널');
  });

  it('sdk-absent: 접두사 → sdkAbsentError 메시지', () => {
    const err = new Error('sdk-absent: window.__sdkCall이 주입되지 않았습니다.');
    const result = classifyToolError(err, 'call_sdk');
    expect(getText(result)).toContain('window.__sdkCall');
    expect(getText(result)).toContain('dogfood');
  });

  it('replaced-by-new-attach → pageCrashError 메시지', () => {
    const err = new Error('[ait-debug] replaced-by-new-attach — 이전 page 교체됨');
    const result = classifyToolError(err, 'take_screenshot');
    expect(getText(result)).toContain('crash');
  });

  it('targetCrashed → pageCrashError 메시지', () => {
    const err = new Error('Inspector.targetCrashed received');
    const result = classifyToolError(err, 'get_dom_document');
    expect(getText(result)).toContain('crash');
  });

  it('relay에 연결되어 있지 않습니다 → relayDisconnectError 메시지', () => {
    const err = new Error('relay에 연결되어 있지 않습니다 (Runtime.evaluate).');
    const result = classifyToolError(err, 'evaluate');
    expect(getText(result)).toContain('relay');
    expect(getText(result)).toContain('list_pages');
  });

  it('relay WebSocket 패턴 → relayDisconnectError 메시지', () => {
    const err = new Error('relay WebSocket 오류: connect ECONNREFUSED');
    const result = classifyToolError(err, 'measure_safe_area');
    expect(getText(result)).toContain('relay');
  });

  it('알 수 없는 에러 → 원본 메시지 + list_pages 안내', () => {
    const err = new Error('some unexpected internal error');
    const result = classifyToolError(err, 'list_network_requests');
    const text = getText(result);
    expect(text).toContain('list_network_requests');
    expect(text).toContain('some unexpected internal error');
    expect(text).toContain('list_pages');
  });

  it('Error 이외의 타입도 처리', () => {
    const result = classifyToolError('plain string error', 'list_exceptions');
    expect(getText(result)).toContain('list_exceptions');
  });
});
