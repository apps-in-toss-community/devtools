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
# Additionally checks the chunk-graph-agnostic runtime resolution (#697):
# Rolldown code-splitting hoists the bundling logic (getRuntimePath) into
# shared chunks emitted at the dist/ ROOT (e.g. debug-server-<hash>.js, pulled
# by dist/mcp/cli.js). The old fixed 3-candidate list assumed dist/test-runner/
# depth and missed from dist/ root — every run_tests / devtools-test call failed
# with esbuild "Could not resolve". The new depth-robust probe ascends from
# import.meta.url's dir until it finds test-runner/runtime.js. This guard
# discovers all carrier chunks and verifies the resolver lands on
# dist/test-runner/runtime.js from each carrier's real directory.
#
# Run after `pnpm build`. Fails (exit 1) if any check fails.
set -euo pipefail

cd "$(dirname "$0")/.."

REQUIRED=(
  "dist/test-runner/runtime.js"
  "dist/test-runner/runtime.d.ts"
  # devtools#740 (DT-2): bridge-stub is resolved via the SAME depth-robust
  # getPageSideModulePath() helper as runtime.js (bundle.ts) — must exist in
  # dist for the same reason runtime.js must.
  "dist/test-runner/bridge-stub.js"
  "dist/test-runner/bridge-stub.d.ts"
  # devtools#769: method-pace is resolved via the SAME depth-robust
  # getPageSideModulePath() helper as runtime.js/bridge-stub.js (bundle.ts) —
  # must exist in dist for the same reason those must.
  "dist/test-runner/method-pace.js"
  "dist/test-runner/method-pace.d.ts"
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

# --- chunk-graph-agnostic runtime resolution guard (#697) ---
# getRuntimePath() is duplicated by rolldown into shared chunks at arbitrary
# dist depths. Instead of assuming WHERE that chunk lands, discover EVERY dist
# .js chunk that carries the nested `test-runner/runtime.js` probe, then run the
# real resolver from each carrier's actual directory and assert it lands on
# dist/test-runner/runtime.js. A future chunk-graph shift that re-breaks
# resolution fails here without anyone hand-enumerating placements.
node --input-type=module -e '
import { accessSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
const DIST = path.resolve("dist");
const EXPECTED = path.join(DIST, "test-runner", "runtime.js");
const walk = (d) => readdirSync(d).flatMap((e) => {
  const p = path.join(d, e);
  return statSync(p).isDirectory() ? walk(p) : (e.endsWith(".js") ? [p] : []);
});
// Marker: getPageSideModulePath (shared by getRuntimePath/getBridgeStubPath,
// devtools#740) builds its nested probe from a template literal, not a
// literal "runtime.js" string — match the generic shape instead.
const MARKER = /\[\s*"test-runner",\s*`\$\{moduleName\}\.js`\s*\]/;
// Replicate the resolver (.js-first, bounded ascent) — mirrors
// getPageSideModulePath called with moduleName="runtime".
const resolve = (startDir) => {
  const probes = [["runtime.js"],["test-runner","runtime.js"],["runtime.ts"],["test-runner","runtime.ts"]];
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    for (const s of probes) { const c = path.join(dir, ...s); try { accessSync(c); return c; } catch {} }
    const par = path.dirname(dir); if (par === dir) break; dir = par;
  }
  return path.join(startDir, "runtime.js");
};
const carriers = walk(DIST).filter((f) => MARKER.test(readFileSync(f, "utf8")));
if (carriers.length === 0) {
  console.error("✗ no dist chunk carries getPageSideModulePath nested probe — marker drift or build shape changed (#697)");
  process.exit(1);
}
let bad = 0;
for (const c of carriers) {
  const got = resolve(path.dirname(c));
  if (got !== EXPECTED) {
    console.error(`✗ ${path.relative(DIST, c)}: runtime resolves to ${path.relative(DIST, got)} (want test-runner/runtime.js) — chunk-graph shift re-broke resolution (#697)`);
    bad++;
  } else {
    console.log(`✓ ${path.relative(DIST, c)}: runtime resolves to test-runner/runtime.js`);
  }
}
process.exit(bad ? 1 : 0);
' || fail=1

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

# relay-factory: heavy graph is permitted but ONLY via dynamic import, so the
# emitted bundle must stay react-free AND must not have the chii/cloudflared graph
# statically inlined. A dynamic `import('../mcp/debug-server.js')` keeps those
# modules in separate chunks (the specifier names debug-server, not chii); if
# someone flips a dynamic import to static, chii-relay's `require('chii')` /
# cloudflared inline into THIS bundle and trip HEAVY_ANCHORS.
RELAY_FACTORY="dist/test-runner/relay-factory.js"
if [[ ! -f "$RELAY_FACTORY" ]]; then
  echo "✗ $RELAY_FACTORY missing — run 'pnpm build' first (check tsdown.config.ts #696 entry)" >&2
  fail=1
elif grep -qE "$REACT_PATTERN" "$RELAY_FACTORY"; then
  echo "✗ #696 VIOLATION: $RELAY_FACTORY imports react — the factory must stay react-free" >&2
  fail=1
elif grep -qE "$HEAVY_ANCHORS" "$RELAY_FACTORY"; then
  echo "✗ #696 VIOLATION: $RELAY_FACTORY statically inlined the heavy graph (server-lock/parent-watcher/chii/cloudflared)" >&2
  echo "  The MCP boot graph must stay behind dynamic import() inside open()." >&2
  fail=1
else
  echo "✓ $RELAY_FACTORY is react-free and heavy-graph-free (#696; heavy graph behind dynamic import)"
fi

# --- #711: bin calls main() guard -------------------------------------------
# dist/test-runner/bin.js must contain an unconditional main() call. If Rolldown
# ever reduces the bin back to a re-export wrapper (e.g. because bin.ts gains
# an export), the main() call disappears and devtools-test / pnpm test:env3
# silently exits 0 — the original #711 regression. This grep catches that.
BIN_FILE="dist/test-runner/bin.js"
if [[ ! -f "$BIN_FILE" ]]; then
  echo "✗ $BIN_FILE missing — run 'pnpm build' first (check tsdown.config.ts #711 entry)" >&2
  fail=1
elif grep -q "main(" "$BIN_FILE"; then
  echo "✓ $BIN_FILE calls main() — bin is not a silent no-op (#711)"
else
  echo "✗ $BIN_FILE does not call main() — bin would be a silent no-op (#711)" >&2
  echo "  Rolldown may have hoisted bin.ts into a shared chunk (re-export wrapper)." >&2
  echo "  Ensure src/test-runner/bin.ts has zero exports so Rolldown keeps main() in-line." >&2
  fail=1
fi

exit "$fail"
