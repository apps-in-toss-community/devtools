/**
 * MCP tool 거부/에러 응답 메시지 헬퍼 — 4상태 차별화 + Tier 거부 통일.
 *
 * 모든 tool 거부/에러 응답을 "원인 + 다음 행동" 한국어 한 줄 포맷으로 일원화한다.
 * debug-server.ts · tools.ts의 거부 응답 호출부가 이 헬퍼를 통해 생성된다.
 *
 * 4가지 상태 (진단 메시지 차별화):
 *   - tunnel-down  : cloudflared 터널 미가동 — 서버 재시작 필요
 *   - page-missing : 페이지가 attach 안 됨 — build_attach_url → QR 스캔
 *   - page-crash   : 페이지 crash 감지 — 앱 재실행 후 재attach
 *   - sdk-absent   : window.__sdkCall 미주입 — dogfood 채널로 재배포
 */

/** MCP tool-result 에러 응답 형식. */
export interface McpErrorResult {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

/**
 * 한국어 한 줄 "원인 + 다음 행동" 포맷으로 에러 결과를 빌드한다.
 *
 * @param message - 사용자에게 보여줄 에러 본문 (원인 + 다음 행동 포함).
 */
export function mcpError(message: string): McpErrorResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Tier 거부 메시지                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Tier A/B 환경 불일치 거부 메시지.
 *
 * @param toolName    - 거부된 tool 이름.
 * @param requiredEnv - 해당 tool이 요구하는 환경 ('mock' | 'relay').
 * @param currentEnv  - 현재 세션 환경.
 * @param reason      - 환경이 결정된 근거 (EnvironmentReason 문자열).
 */
export function tierRejectionError(
  toolName: string,
  requiredEnv: string,
  currentEnv: string,
  reason: string,
): McpErrorResult {
  const envLabel = requiredEnv === 'relay' ? 'relay (실기기 연결)' : 'mock (로컬 브라우저)';
  const currentLabel = currentEnv === 'relay' ? 'relay' : 'mock';
  const hint =
    requiredEnv === 'relay'
      ? 'relay로 전환하려면 MCP_ENV=relay 설정 후 서버를 재시작하고 build_attach_url → QR 스캔으로 실기기를 attach하세요.'
      : 'mock으로 전환하려면 MCP_ENV=mock 설정 후 서버를 재시작하세요.';
  const text =
    `${toolName}은 ${envLabel} 환경에서만 사용할 수 있습니다. ` +
    `현재 환경: ${currentLabel} (${reason}). ${hint}`;
  // 하위 호환 — 기존 테스트가 기대하는 영문 패턴도 유지
  const compat = `tool ${toolName} is available only in ${requiredEnv}. Current environment is ${currentEnv} (${reason}).`;
  return mcpError(`${text}\n\n${compat}`);
}

/* -------------------------------------------------------------------------- */
/* 4상태 차별화 메시지                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 상태 1: tunnel 미가동 — cloudflared 터널이 아직 뜨지 않았다.
 *
 * `build_attach_url` 호출 시 tunnel.up === false 인 경우.
 */
export function tunnelDownError(): McpErrorResult {
  return mcpError(
    'cloudflared 터널이 안 떠 있습니다. ' +
      'MCP 서버를 재시작하거나 잠시 후 list_pages로 터널 상태를 다시 확인하세요.',
  );
}

/**
 * 상태 2: page 미attach — 터널은 살아 있으나 아직 페이지가 연결되지 않았다.
 *
 * enableDomains()가 "No mini-app page attached" 에러를 던질 때.
 */
export function pageMissingError(toolName?: string): McpErrorResult {
  const prefix = toolName ? `${toolName}: ` : '';
  return mcpError(
    `${prefix}페이지가 attach 안 됨. ` +
      'dogfood 번들 배포 후 build_attach_url을 호출해 QR을 생성하세요: ' +
      '`ait deploy --scheme-only` → `build_attach_url(scheme_url)` → QR 스캔.',
  );
}

/**
 * 상태 3: page crash — 연결됐던 페이지가 crash/destroy됐다.
 *
 * chii-connection 이 'replaced-by-new-attach' / 'targetCrashed' / 'targetDestroyed' 를
 * 던질 때 이 메시지를 사용한다.
 */
export function pageCrashError(toolName?: string): McpErrorResult {
  const prefix = toolName ? `${toolName}: ` : '';
  return mcpError(
    `${prefix}페이지가 crash됐습니다. ` +
      '토스 앱을 재실행한 뒤 build_attach_url → QR 스캔으로 재attach하세요.',
  );
}

/**
 * 상태 4: SDK 부재 — window.__sdkCall이 주입되지 않았다 (dogfood 빌드가 아님).
 *
 * call_sdk 호출 시 브리지가 없을 때.
 */
export function sdkAbsentError(toolName?: string): McpErrorResult {
  const prefix = toolName ? `${toolName}: ` : '';
  return mcpError(
    `${prefix}window.__sdkCall이 주입되지 않았습니다 (dogfood 빌드가 아닙니다). ` +
      'dogfood 채널(intoss-private)로 재배포 후 QR을 다시 스캔하세요: ' +
      '`ait build && aitcc app deploy`.',
  );
}

/* -------------------------------------------------------------------------- */
/* relay 연결 끊김 메시지                                                        */
/* -------------------------------------------------------------------------- */

/**
 * relay WebSocket 연결이 끊겼을 때 — 크래시가 아닌 네트워크/프로세스 종료.
 */
export function relayDisconnectError(toolName?: string): McpErrorResult {
  const prefix = toolName ? `${toolName}: ` : '';
  return mcpError(
    `${prefix}relay 연결이 끊겼습니다. ` +
      'list_pages로 상태를 확인하고, 필요하면 앱을 재실행 후 재attach하세요.',
  );
}

/* -------------------------------------------------------------------------- */
/* 일반 tool 에러 메시지                                                          */
/* -------------------------------------------------------------------------- */

/**
 * CDP/AIT 명령 중 발생한 예외를 4상태로 분류해 적절한 에러 결과를 반환한다.
 *
 * - SDK 부재 패턴 (`window.__sdkCall is not available`) → sdkAbsentError
 * - crash 패턴 (`replaced-by-new-attach`, `targetCrashed`, `targetDestroyed`) → pageCrashError
 * - 연결 끊김 패턴 (`relay에 연결되어 있지 않습니다`, `relay WebSocket`) → relayDisconnectError
 * - 그 외 (일반 에러) → 원본 메시지를 포함한 mcpError
 */
export function classifyToolError(err: unknown, toolName: string): McpErrorResult {
  const message = err instanceof Error ? err.message : String(err);

  // 상태 1: tunnel 미가동 (buildAttachUrl이 던지는 패턴)
  if (message.startsWith('tunnel-down:') || message.includes('터널이 안 떠 있습니다')) {
    return tunnelDownError();
  }

  // 상태 4: SDK 부재
  if (
    message.startsWith('sdk-absent:') ||
    message.includes('__sdkCall이 주입되지 않았습니다') ||
    message.includes('window.__sdkCall is not available') ||
    (message.includes('__sdkCall') && message.includes('not available'))
  ) {
    return sdkAbsentError(toolName);
  }

  // 상태 3: page crash / target destroyed / replaced-by-new-attach
  if (
    message.includes('replaced-by-new-attach') ||
    message.includes('targetCrashed') ||
    message.includes('targetDestroyed') ||
    message.includes('detachedFromTarget')
  ) {
    return pageCrashError(toolName);
  }

  // relay 연결 끊김 (단순 disconnect — crash 아님)
  if (message.includes('relay에 연결되어 있지 않습니다') || message.includes('relay WebSocket')) {
    return relayDisconnectError(toolName);
  }

  // 그 외: 원본 메시지를 포함하되 list_pages 다음 행동 안내 추가
  return mcpError(
    `${toolName} 실패: ${message}\nlist_pages로 미니앱이 relay에 attach됐는지 확인하세요.`,
  );
}
