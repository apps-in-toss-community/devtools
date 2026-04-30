#!/usr/bin/env bash
# setup-worktree.sh — Post-create hook for cw worktrees.
# Installs pnpm dependencies after worktree creation.
set -euo pipefail

echo "📦 Installing pnpm dependencies..."
pnpm install --frozen-lockfile --prefer-offline
echo "✅ Worktree setup complete."
