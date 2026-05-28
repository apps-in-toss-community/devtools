#!/usr/bin/env bash
# Redact secrets from an iOS crash log (.ips) before sharing.
#
# Usage:
#   scripts/redact-crash-log.sh < input.ips > redacted.ips
#   scripts/redact-crash-log.sh input.ips > redacted.ips
#
# What gets redacted:
#   relay=wss://...       → relay=<REDACTED>
#   at=<TOTP code>        → at=<REDACTED_TOTP>
#   _deploymentId=<uuid>  → _deploymentId=<UUID>

set -euo pipefail

input="${1:--}"   # read from file arg or stdin

sed -E \
  -e 's|relay=wss://[^&" ]*|relay=<REDACTED>|g' \
  -e 's|at=[A-Z0-9]{6,8}|at=<REDACTED_TOTP>|g' \
  -e 's|_deploymentId=[a-f0-9-]{36}|_deploymentId=<UUID>|g' \
  -- "${input}"
