#!/usr/bin/env bash
# Install-graph invariant guard.
#
# react/react-dom are devDependencies ONLY. The MCP daemon bundles
# (dist/mcp/cli.js, dist/mcp/server.js) are what every MCP-only user runs via
# `npx @ait-co/devtools devtools-mcp` — they must NEVER statically (or lazily)
# import react/react-dom, or those frameworks get forced into the runtime
# install graph of users who never render a browser UI.
#
# The user-facing dashboard/attach HTML is precompiled to plain strings at BUILD
# time (scripts/dashboard/, react-dom/server in a build-only script), so the
# runtime mcp chain (cli.ts → debug-server.ts → qr-http-server.ts) stays
# react-free. This script is the mechanical proof of that invariant.
#
# Run after `pnpm build`. Fails (exit 1) if react leaks into a daemon bundle.
set -euo pipefail

cd "$(dirname "$0")/.."

DAEMON_BUNDLES=("dist/mcp/cli.js" "dist/mcp/server.js")
# Match a real react import/require, not an incidental substring (e.g. a URL or
# the word "reaction" in a comment).
PATTERN="react-dom|from[[:space:]]*['\"]react['\"]|require\\(['\"]react"

fail=0
for bundle in "${DAEMON_BUNDLES[@]}"; do
  if [[ ! -f "$bundle" ]]; then
    echo "✗ $bundle missing — run 'pnpm build' first" >&2
    fail=1
    continue
  fi
  if grep -qE "$PATTERN" "$bundle"; then
    echo "✗ INSTALL-GRAPH VIOLATION: $bundle imports react/react-dom" >&2
    echo "  The MCP daemon must stay react-free. Author dashboard HTML as a" >&2
    echo "  build-time precompile (scripts/dashboard/), not a runtime import." >&2
    fail=1
  else
    echo "✓ $bundle is react-free"
  fi
done

exit "$fail"
