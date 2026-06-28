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
# Run after `pnpm build`. Fails (exit 1) if any required test-runner artifact
# is missing.
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

exit "$fail"
