#!/usr/bin/env bash
# Build-artifact presence guard for test-runner/runtime.
#
# dist/test-runner/runtime.js is loaded at runtime by bundleTestFile via an
# absolute filesystem path (getRuntimePath in bundle.ts). Unlike other entries
# it is NOT reachable via a package subpath specifier, so tsc and the normal
# typecheck pass cannot catch its absence — only a post-build file check can.
#
# This guard closes the gap that allowed the #676 regression (missing tsdown
# entry → no dist/runtime.js → "Could not resolve" on every run_tests call)
# to ship undetected.
#
# Additionally checks that the dist/mcp/cli.js entry can resolve the runtime
# via getRuntimePath's sibling-directory candidate (#678):
#   getRuntimePath from dist/mcp/ → tries ../test-runner/runtime.js
#   → that resolves to dist/test-runner/runtime.js, which must exist.
# Also asserts that dist/mcp/cli.js does NOT contain a hard-coded
# "mcp/runtime.js" reference (which would indicate the co-location
# assumption leaked into the compiled output).
#
# Run after `pnpm build`. Fails (exit 1) if any check fails.
set -euo pipefail

cd "$(dirname "$0")/.."

REQUIRED=(
  "dist/test-runner/runtime.js"
  "dist/test-runner/runtime.d.ts"
)

fail=0
for artifact in "${REQUIRED[@]}"; do
  if [[ ! -f "$artifact" ]]; then
    echo "✗ $artifact missing — run 'pnpm build' first (or check tsdown.config.ts entry)" >&2
    fail=1
  else
    echo "✓ $artifact exists"
  fi
done

# --- dist/mcp entry invariant (#678) ---
# getRuntimePath in dist/mcp/cli.js resolves "../test-runner/runtime.js"
# which must exist as dist/test-runner/runtime.js.
MCP_RUNTIME_SIBLING="dist/test-runner/runtime.js"
if [[ ! -f "$MCP_RUNTIME_SIBLING" ]]; then
  echo "✗ dist/mcp entry: sibling runtime '$MCP_RUNTIME_SIBLING' missing" \
    "— getRuntimePath will fail from the dist/mcp/ context (#678)" >&2
  fail=1
else
  echo "✓ dist/mcp entry: sibling runtime '$MCP_RUNTIME_SIBLING' reachable"
fi

# Ensure no stale "mcp/runtime.js" hard-coded reference leaked into mcp/cli.js.
MCP_CLI="dist/mcp/cli.js"
if [[ -f "$MCP_CLI" ]]; then
  # Exclude JSDoc/comment lines (lines whose first non-space chars are `*` or `//`)
  # — the bundler may inline docblock text that mentions mcp/runtime.js in prose.
  # We only care about live string literals / require() paths in code.
  if grep "mcp/runtime\.js" "$MCP_CLI" 2>/dev/null | grep -qv '^\s*[*/]'; then
    echo "✗ $MCP_CLI contains a non-comment 'mcp/runtime.js' reference — stale co-location path leaked into build (#678)" >&2
    fail=1
  else
    echo "✓ $MCP_CLI: no stale 'mcp/runtime.js' code reference"
  fi
else
  echo "✗ $MCP_CLI missing — run 'pnpm build' first" >&2
  fail=1
fi

# --- #696: capture/report/relay-factory graph invariants ----------------------
# capture.ts and report.ts are deliberately LEAF modules: react-free AND free of
# the heavy MCP graph (server-lock, parent-watcher, chii/cloudflared). They are
# re-exported from the `@ait-co/devtools/test-runner` barrel (config.ts), so if
# they ever statically pulled the daemon graph, that graph would land on the
# Node-config entry every consumer's vitest.config.ts imports. relay-factory is
# allowed the heavy graph but ONLY behind dynamic import — so its STATIC bundle
# must still be react-free.
#
# A static `import x from 'react'` survives as a top-level import; a dynamic
# `import('...')` is a call expression and is intentionally NOT matched by the
# react pattern (we ban react entirely, which no path here should ever need).
REACT_PATTERN="react-dom|from[[:space:]]*['\"]react['\"]|require\\(['\"]react"

# Leaf modules: must be free of react AND the heavy-graph anchors.
LEAF_ENTRIES=("dist/test-runner/capture.js" "dist/test-runner/report.js")
# Anchors whose presence proves the heavy MCP/daemon graph was pulled in. Matched
# ONLY as quoted import/require specifiers (`'...server-lock...'`) so a docblock
# that merely names the chii/cloudflared graph in prose is not a false positive.
HEAVY_ANCHORS="['\"][^'\"]*(server-lock|parent-watcher|chii|cloudflared)[^'\"]*['\"]"

for entry in "${LEAF_ENTRIES[@]}"; do
  if [[ ! -f "$entry" ]]; then
    echo "✗ $entry missing — run 'pnpm build' first (check tsdown.config.ts #696 entry)" >&2
    fail=1
    continue
  fi
  if grep -qE "$REACT_PATTERN" "$entry"; then
    echo "✗ #696 LEAF VIOLATION: $entry imports react — capture/report must stay react-free" >&2
    fail=1
  elif grep -qE "$HEAVY_ANCHORS" "$entry"; then
    echo "✗ #696 LEAF VIOLATION: $entry pulled the heavy MCP graph (server-lock/parent-watcher/chii/cloudflared)" >&2
    echo "  capture.ts/report.ts must be pure leaves so the test-runner barrel re-export stays light." >&2
    fail=1
  else
    echo "✓ $entry is react-free and heavy-graph-free (#696)"
  fi
done

# relay-factory: heavy graph is permitted but ONLY via dynamic import. The static
# surface must still be react-free.
RELAY_FACTORY="dist/test-runner/relay-factory.js"
if [[ ! -f "$RELAY_FACTORY" ]]; then
  echo "✗ $RELAY_FACTORY missing — run 'pnpm build' first (check tsdown.config.ts #696 entry)" >&2
  fail=1
elif grep -qE "$REACT_PATTERN" "$RELAY_FACTORY"; then
  echo "✗ #696 VIOLATION: $RELAY_FACTORY imports react — the factory must stay react-free" >&2
  fail=1
else
  echo "✓ $RELAY_FACTORY is react-free (#696; heavy graph behind dynamic import)"
fi

exit "$fail"
