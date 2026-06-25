#!/usr/bin/env bash
# Build-time absence guard for the in-app debug surface (issue #647).
#
# The in-app debug surface — Chii target.js injection AND the eruda console it
# pulls in — must be PHYSICALLY ABSENT (zero bytes) from a release consumer
# bundle, not merely gated at runtime. A consumer guards its
# `import('@ait-co/devtools/in-app')` with `if (__DEBUG_BUILD__) { … }`; a
# release build defines `__DEBUG_BUILD__: false`, and the bundler
# dead-code-eliminates the whole in-app graph. This script is the mechanical
# proof of that, plus a check that eruda never leaks into the MCP daemon bundles.
#
# Three checks:
#   1. MCP daemon bundles (dist/mcp/*.js) contain no `eruda` — those run via
#      `npx @ait-co/devtools devtools-mcp` and must never pull a browser console
#      into the install/runtime graph (mirrors check-mcp-react-free.sh).
#   2. RELEASE fixture build (AIT_DEBUG_BUILD unset, NODE_ENV=production,
#      minify ON) contains no debug-surface sentinels — proves DCE works.
#   3. POSITIVE CONTROL: DEBUG fixture build (AIT_DEBUG_BUILD=1) DOES contain
#      them — proves the toggle is alive (guards against a dead grep that would
#      pass even if the build guard silently stopped including anything).
#
# IMPORTANT: the release build MUST be minified. With minify off, a dead
# `if(false){ … }` husk survives as text and its identifier strings (e.g.
# `eruda`) match the grep — a false positive. Vite production builds minify by
# default; do not pass --minify=false here.
set -euo pipefail

cd "$(dirname "$0")/.."

# Sentinels that mark the in-app debug surface. `eruda` covers the console;
# the others are unique identifiers from the Chii injection path that survive
# into a bundle only if the in-app graph was included.
PATTERN="eruda|deriveTargetScriptUrl|installRelayWsObserver|maybeAttach"

FIXTURE_CONFIG="e2e/fixture/vite.config.ts"
OUT_DIR="e2e/fixture/dist/assets"

fail=0

# ── Check 1: MCP daemon bundles are eruda-free ───────────────────────────────
DAEMON_BUNDLES=("dist/mcp/cli.js" "dist/mcp/server.js")
for bundle in "${DAEMON_BUNDLES[@]}"; do
  if [[ ! -f "$bundle" ]]; then
    echo "✗ $bundle missing — run 'pnpm build' first" >&2
    fail=1
    continue
  fi
  if grep -qE "eruda" "$bundle"; then
    echo "✗ INSTALL-GRAPH VIOLATION: $bundle references eruda" >&2
    echo "  The MCP daemon must never import the eruda console." >&2
    fail=1
  else
    echo "✓ $bundle is eruda-free"
  fi
done

# ── Check 2: RELEASE fixture build has zero debug surface ─────────────────────
echo "› Building fixture in RELEASE mode (AIT_DEBUG_BUILD unset, minified)…"
rm -rf "$OUT_DIR"
NODE_ENV=production pnpm exec vite build --config "$FIXTURE_CONFIG" >/dev/null 2>&1
if grep -rlE "$PATTERN" "$OUT_DIR" >/dev/null 2>&1; then
  echo "✗ DEBUG-SURFACE LEAK: release bundle contains debug-surface code" >&2
  echo "  Files:" >&2
  grep -rlE "$PATTERN" "$OUT_DIR" | sed 's/^/    /' >&2
  echo "  The in-app graph (Chii injection + eruda) must DCE in release builds." >&2
  echo "  Check the consumer's if(__DEBUG_BUILD__) guard and the define." >&2
  fail=1
else
  echo "✓ release fixture bundle is debug-surface-free (0 bytes)"
fi

# ── Check 3: POSITIVE CONTROL — debug build DOES contain the surface ──────────
echo "› Building fixture in DEBUG mode (AIT_DEBUG_BUILD=1) for positive control…"
rm -rf "$OUT_DIR"
AIT_DEBUG_BUILD=1 NODE_ENV=production pnpm exec vite build --config "$FIXTURE_CONFIG" >/dev/null 2>&1
if grep -rlE "$PATTERN" "$OUT_DIR" >/dev/null 2>&1; then
  echo "✓ debug fixture bundle contains the debug surface (toggle is alive)"
else
  echo "✗ POSITIVE-CONTROL FAILURE: debug build has NO debug surface" >&2
  echo "  The __DEBUG_BUILD__ toggle appears dead — the release check above is" >&2
  echo "  meaningless if the debug build also excludes everything." >&2
  fail=1
fi

# Leave the tree in the default (release) state.
rm -rf "$OUT_DIR"

exit "$fail"
