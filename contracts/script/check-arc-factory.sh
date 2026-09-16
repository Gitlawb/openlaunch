#!/usr/bin/env bash
# src/LaunchFactoryArc.sol must be src/LaunchFactory.sol plus exactly the Arc guard (contract note, name, error,
# constant, one revert line). Fails when the two files drift apart in any other way. Run from contracts/.
set -euo pipefail
cd "$(dirname "$0")/.."
expected=docs/LaunchFactoryArc.diff
actual=$(diff src/LaunchFactory.sol src/LaunchFactoryArc.sol | sed -E 's/[[:space:]]+$//' || true)
if [[ "${1:-}" == "--update" ]]; then printf '%s\n' "$actual" > "$expected"; echo "updated $expected"; exit 0; fi
if [[ "$actual" != "$(sed -E 's/[[:space:]]+$//' "$expected")" ]]; then
  echo "src/LaunchFactoryArc.sol differs from src/LaunchFactory.sol in more than the Arc guard:"; diff <(printf '%s\n' "$actual") "$expected" || true; exit 1
fi
echo "ok: LaunchFactoryArc.sol = LaunchFactory.sol + the Arc guard only"
