/**
 * inspectorUrl 생성 경로 — TOTP 있음/없음 × target 있음/없음 매트릭스 (issue #509).
 *
 * 결함 요약 (#509):
 *   대시보드 "인스펙터 열기" 링크가 relay 세션에서 영구히 "WebSocket disconnected"
 *   상태였다. 근본 원인: buildChiiInspectorUrl이 mintTotp 없으면 at= 없는 URL을 조용히
 *   반환했다(fail-open). relay 게이트는 at= 없는 모든 WS 업그레이드를 4401로 거부하므로
 *   해당 링크는 항상 실패했다.
 *
 * 수정 (#509):
 *   buildChiiInspectorUrl은 mintTotp 없으면 null을 반환(fail-closed). 호출처가
 *   null을 받으면 링크 대신 waiting hint를 표시한다.
 *
 * SECRET-HANDLING: 테스트는 가짜 시크릿 상수(FIXTURE_SECRET)만 사용. at= 코드 값은
 * toContain('at=') 등 존재 여부만 검증하며 stdout/stderr/로그에 절대 출력하지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { buildChiiInspectorUrl } from '../devtools-opener.js';
import { generateTotp } from '../totp.js';

/** 64 hex chars = 32 bytes — 실제 시크릿 값이 아닌 테스트 픽스처. */
const FIXTURE_SECRET = 'cafebabe'.repeat(8);
const fixtureMintTotp = () => '654321';

// ---------------------------------------------------------------------------
// 매트릭스: TOTP getter 있음/없음 × relay-dev(HTTP) / relay-mobile(HTTPS)
// ---------------------------------------------------------------------------

describe('buildChiiInspectorUrl — TOTP 있음/없음 × relay 환경 매트릭스 (issue #509)', () => {
  // ── 시크릿 없음 (fail-closed) ─────────────────────────────────────────
  describe('mintTotp 없음 → null 반환 (fail-closed)', () => {
    it('relay-dev (HTTP, env 3/4): mintTotp 미전달 → null', () => {
      const result = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-1');
      expect(result).toBeNull();
    });

    it('relay-mobile (HTTPS tunnel, env 2): mintTotp 미전달 → null', () => {
      const result = buildChiiInspectorUrl('https://abc.trycloudflare.com', 'target-2');
      expect(result).toBeNull();
    });

    it('relay-dev: mintTotp undefined 명시 → null', () => {
      const result = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-3', undefined);
      expect(result).toBeNull();
    });

    it('relay-mobile: mintTotp undefined 명시 → null', () => {
      const result = buildChiiInspectorUrl('https://abc.trycloudflare.com', 'target-4', undefined);
      expect(result).toBeNull();
    });
  });

  // ── 시크릿 있음 → at= 포함 URL 반환 ────────────────────────────────
  describe('mintTotp 있음 → at= 포함 URL 반환', () => {
    it('relay-dev (HTTP): at= 코드 포함 + ws= 파라미터', () => {
      const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-5', fixtureMintTotp);
      expect(url).not.toBeNull();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:9100\/front_end\/chii_app\.html\?/);
      const parsed = new URL(url as string);
      const wsParam = decodeURIComponent(parsed.searchParams.get('ws') ?? '');
      expect(wsParam).toContain('at=654321');
      // relay-dev: ws= (평문, TLS 아님)
      expect(parsed.searchParams.get('ws')).toBeTruthy();
      expect(parsed.searchParams.get('wss')).toBeNull();
    });

    it('relay-mobile (HTTPS tunnel): at= 코드 포함 + wss= 파라미터', () => {
      const url = buildChiiInspectorUrl(
        'https://abc.trycloudflare.com',
        'target-6',
        fixtureMintTotp,
      );
      expect(url).not.toBeNull();
      expect(url).toMatch(/^https:\/\/abc\.trycloudflare\.com\/front_end\/chii_app\.html\?/);
      const parsed = new URL(url as string);
      const wssParam = decodeURIComponent(parsed.searchParams.get('wss') ?? '');
      expect(wssParam).toContain('at=654321');
      // relay-mobile: wss= (TLS — HTTPS 터널)
      expect(parsed.searchParams.get('wss')).toBeTruthy();
      expect(parsed.searchParams.get('ws')).toBeNull();
    });

    it('at= 코드는 mintTotp()가 반환한 값과 일치한다', () => {
      const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'tgt', () => '999888');
      expect(url).not.toBeNull();
      const parsed = new URL(url as string);
      const wsParam = decodeURIComponent(parsed.searchParams.get('ws') ?? '');
      expect(wsParam).toContain('at=999888');
    });

    it('generateTotp(secret)로 생성한 mintTotp → URL에 6자리 코드 포함', () => {
      // 실제 TOTP 코드 생성 경로 검증 — 코드 값은 검증하지 않고 형식(6자리)만 확인.
      const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'tgt', () =>
        generateTotp(FIXTURE_SECRET),
      );
      expect(url).not.toBeNull();
      const parsed = new URL(url as string);
      const wsParam = decodeURIComponent(parsed.searchParams.get('ws') ?? '');
      // at= 뒤에 6자리 숫자 패턴 — 코드 값 자체는 출력/스냅샷 금지.
      expect(wsParam).toMatch(/at=\d{6}/);
    });
  });

  // ── /client/ 경로 + target id 포함 확인 ─────────────────────────────
  describe('WS 경로 구조 검증', () => {
    it('WS 경로에 /client/ 경로와 targetId가 모두 포함된다', () => {
      const url = buildChiiInspectorUrl(
        'http://127.0.0.1:9100',
        'my-unique-target',
        fixtureMintTotp,
      );
      expect(url).not.toBeNull();
      const parsed = new URL(url as string);
      const wsParam = decodeURIComponent(parsed.searchParams.get('ws') ?? '');
      expect(wsParam).toContain('/client/');
      expect(wsParam).toContain('target=my-unique-target');
    });

    it('WS 경로는 scheme(http://)이 아니라 host로 시작한다', () => {
      const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'tgt', fixtureMintTotp);
      expect(url).not.toBeNull();
      const parsed = new URL(url as string);
      const wsParam = decodeURIComponent(parsed.searchParams.get('ws') ?? '');
      expect(wsParam).toMatch(/^127\.0\.0\.1:9100/);
    });
  });

  // ── SECRET-HANDLING ──────────────────────────────────────────────────
  describe('SECRET-HANDLING: 시크릿 값이 URL에 포함되지 않는다', () => {
    it('mintTotp가 반환한 코드만 노출되고 FIXTURE_SECRET 자체는 포함되지 않는다', () => {
      const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'tgt', fixtureMintTotp);
      expect(url).not.toBeNull();
      expect(url).not.toContain(FIXTURE_SECRET);
    });
  });
});
