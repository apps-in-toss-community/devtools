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

exit "$fail"
