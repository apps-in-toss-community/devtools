/**
 * Structured JSON-line server logger + allowlist-based secret redact.
 *
 * Every log line emitted by the debug-mode MCP server is a single JSON object:
 *   { "ts": "<ISO-8601>", "level": "info"|"warn"|"error", "event": "<category>", ...fields }
 *
 * Allowlist approach — only the keys in ALLOWED_KEYS pass through to the output
 * object unchanged. Any value that matches a known-secret pattern is replaced
 * with "***" regardless of key name. This provides two complementary layers:
 *   1. Key allowlist  — unknown keys (e.g. a future field accidentally containing
 *      a credential) are dropped entirely.
 *   2. Value redact   — pattern matching catches secrets that slip through under
 *      an allowed key name (e.g. a message string that includes a TOTP code).
 *
 * SECRET-HANDLING (MUST NOT appear in stdout/stderr/logs):
 *   - TOTP 6-digit codes (pattern: standalone 6-digit run)
 *   - AITCC_API_KEY values (pattern: "aitcc_" or "AITCC_" prefix — Deploy Key format)
 *   - cookie header values (pattern: "cookie:" header content)
 *   - relay WSS URLs (contain the relay host which is semi-sensitive)
 *   - "at=<TOTP>" query params
 *
 * Canonical event categories:
 *   server.start    — MCP server started (relay port, TOTP enabled, etc.)
 *   tunnel.up       — cloudflared tunnel assigned a public URL
 *   tunnel.down     — tunnel error / shutdown
 *   page.attached   — first CDP target appeared (deploymentId, env)
 *   page.detached   — target evicted / session replaced
 *   page.crashed    — target crash detected
 *   tool.call       — MCP tool invocation (tool name only — no args/results)
 *   tool.error      — MCP tool error (tool name + safe error category)
 */

/** Structured log levels. */
export type LogLevel = 'info' | 'warn' | 'error';

/** Every valid event category. */
export type LogEvent =
  | 'server.start'
  | 'tunnel.up'
  | 'tunnel.down'
  | 'page.attached'
  | 'page.detached'
  | 'page.crashed'
  | 'tool.call'
  | 'tool.error'
  // run_tests progress (#646) — operator-visible in the daemon log, never in
  // the agent response. Carries only counts (secret-free, redact-safe numbers).
  | 'run_tests.start'
  | 'run_tests.done';

/**
 * Allowed field keys that may pass through to a log line.
 * Unknown keys are dropped. Values are still redact-scanned.
 */
const ALLOWED_KEYS = new Set([
  'ts',
  'level',
  'event',
  'msg',
  'port',
  'totpEnabled',
  'env',
  'tool',
  'deploymentId',
  'errorKind',
  'reason',
  'prevTargetId',
  'mode',
  // run_tests progress counts (#646) — numbers, redact-safe.
  'fileCount',
  'passed',
  'failed',
  'skipped',
]);

/**
 * Patterns that match secret values.
 * Match order matters — more-specific patterns first.
 *
 * #268 redact script covers: relay=wss://…, at=<TOTP>, _deploymentId=<uuid>.
 * Here we extend to in-process value-level patterns used in server logs.
 */
const SECRET_PATTERNS: RegExp[] = [
  // TOTP 6-digit code as a standalone value (whole string is exactly 6 digits).
  /^\d{6}$/,
  // Deploy Key — AITCC_API_KEY value prefix formats.
  /^(aitcc_|AITCC_)/i,
  // Cookie header value (whole string starts with a cookie-like name=value pair).
  /^[A-Za-z0-9_-]+=.{4,}/,
  // WSS relay URL value.
  /^wss:\/\//,
  // TOTP "at=" query param embedded in a string.
  /(?:^|[?&])at=[A-Z0-9]{6}/i,
];

/**
 * Returns `true` when the string value matches any known-secret pattern.
 * Only string values are tested — numbers/booleans are always safe.
 */
function isSecretValue(value: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(value));
}

/**
 * Redacts a single scalar value.
 * - strings: return "***" if the value matches a secret pattern.
 * - other: return as-is.
 */
function redactValue(value: unknown): unknown {
  if (typeof value === 'string' && isSecretValue(value)) {
    return '***';
  }
  return value;
}

/**
 * Builds a safe log payload from raw fields.
 *
 * - Only keys in `ALLOWED_KEYS` are included.
 * - String values are scanned for secret patterns and replaced with "***".
 * - `ts` and `level` and `event` are always included (they are injected by the
 *   logger functions below, not by callers).
 */
function buildPayload(
  level: LogLevel,
  event: LogEvent,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
  };

  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    // ts/level/event are controlled above.
    if (key === 'ts' || key === 'level' || key === 'event') continue;
    out[key] = redactValue(value);
  }

  return out;
}

/**
 * Writes a single JSON log line to stderr.
 * MCP stdio transport uses stdout; all diagnostics go to stderr.
 */
function writeLog(level: LogLevel, event: LogEvent, fields: Record<string, unknown> = {}): void {
  const payload = buildPayload(level, event, fields);
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

// ---------------------------------------------------------------------------
// Public logger functions — one per level.
// ---------------------------------------------------------------------------

/** Log an informational structured event. */
export function logInfo(event: LogEvent, fields: Record<string, unknown> = {}): void {
  writeLog('info', event, fields);
}

/** Log a warning structured event. */
export function logWarn(event: LogEvent, fields: Record<string, unknown> = {}): void {
  writeLog('warn', event, fields);
}

/** Log an error structured event. */
export function logError(event: LogEvent, fields: Record<string, unknown> = {}): void {
  writeLog('error', event, fields);
}

// ---------------------------------------------------------------------------
// Exported redact helper for use in tests and callers that need to sanitise
// before passing to the logger (e.g. error message strings).
// ---------------------------------------------------------------------------

/**
 * Returns a redacted copy of `value`:
 * - string: "***" if it matches a secret pattern, otherwise the original.
 * - other types: returned as-is.
 *
 * Exposed for unit tests and for callers that build dynamic `msg` strings.
 */
export function redact(value: unknown): unknown {
  return redactValue(value);
}
