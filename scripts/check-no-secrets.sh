#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Zero-secrets gate for the ENTIRE public repo. Fails if anything that looks like
# a real key / secret / private endpoint appears anywhere in the tree (core, CLI,
# examples, docs, configs, .env.example, test fixtures). A key in a public repo is
# compromised forever — this is a HARD gate, run in CI and before every publish.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Scan the whole tree, excluding build output / deps / vcs.
FILES=$(git -C "$ROOT" ls-files 2>/dev/null || find "$ROOT" -type f \
  -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.git/*')

# Patterns that indicate a leaked secret. Deliberately broad.
PATTERNS=(
  'sk-[A-Za-z0-9]{20,}'                                # OpenAI-style keys
  'sk-or-v1-[A-Za-z0-9]{20,}'                          # OpenRouter keys
  'sk-ant-[A-Za-z0-9-]{20,}'                           # Anthropic keys
  'whsec_[A-Za-z0-9]{16,}'                             # webhook signing secrets
  '(live|test)_[A-Za-z0-9]{24,}'                       # Dodo/Stripe-style keys
  'helius-rpc\.com/\?api-key=[A-Za-z0-9-]{16,}'        # Helius RPC with embedded key
  'api-key=[A-Za-z0-9]{24,}'                           # generic embedded api-key in a URL
  '[0-9]{8,10}:[A-Za-z0-9_-]{35}'                      # Telegram bot token
  'postgres(ql)?://[^:@ ]+:[^@ ]+@(?!localhost|127\.0\.0\.1)[^/ ]+'  # remote DB creds (not localhost)
  '[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}'       # JWT-shaped
  'BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY'
  '[0-9a-fA-F]{64}'                                    # 64-byte hex (raw AES / Solana secret key)
  '[1-9A-HJ-NP-Za-km-z]{80,}'                          # long base58 (Solana secret key length)
)

# Known-private Corine hosts/services that must NEVER appear in the open repo.
HOSTS='helius-rpc\.com|supermemory|dodopayments|covalenthq|goldrush|cryptopanic|sanctum-api|ironforge|api\.corine\.in'

fail=0
while IFS= read -r f; do
  [ -f "$ROOT/$f" ] || continue
  case "$f" in
    scripts/check-no-secrets.sh) continue ;;   # this file defines the patterns
  esac
  for pat in "${PATTERNS[@]}"; do
    if grep -InEq "$pat" "$ROOT/$f" 2>/dev/null; then
      echo "❌ secret-shaped match /$pat/ in $f:"; grep -InE "$pat" "$ROOT/$f" | head -3; fail=1
    fi
  done
  if grep -InEq "$HOSTS" "$ROOT/$f" 2>/dev/null; then
    echo "❌ private Corine host in $f:"; grep -InE "$HOSTS" "$ROOT/$f" | head -3; fail=1
  fi
done <<< "$FILES"

if [ "$fail" -ne 0 ]; then
  echo ""; echo "Refusing to pass: a secret/private host must never ship in the open repo."; exit 1
fi
echo "✅ No secrets or private hosts found anywhere in the repo tree."
