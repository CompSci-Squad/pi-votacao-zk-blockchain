#!/usr/bin/env bash
# scripts/verify_checksums.sh
#
# Verifies that the synced ZK artifacts in scripts/artifacts/ + the on-chain
# Verifier.sol match the CHECKSUMS.txt published by the circuits repo build.
#
# Provenance chain proven by this script:
#   pi-votacao-zk-circuits/build/CHECKSUMS.txt
#     ⇄ pi-votacao-zk-blockchain/scripts/artifacts/{wasm,zkey,vkey}
#     ⇄ pi-votacao-zk-blockchain/src/Verifier.sol
#
# Exits 0 on full match, non-zero otherwise.

set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKCHAIN_ROOT="$(cd "$THIS_DIR/.." && pwd)"
ARTIFACT_DIR="$BLOCKCHAIN_ROOT/scripts/artifacts"
VERIFIER_LOCAL="$BLOCKCHAIN_ROOT/src/Verifier.sol"
CHECKSUMS_LOCAL="$ARTIFACT_DIR/CHECKSUMS.txt"

if [[ ! -f "$CHECKSUMS_LOCAL" ]]; then
  echo "✗ $CHECKSUMS_LOCAL not found." >&2
  echo "  Run: npm run sync:circuit" >&2
  exit 1
fi

fail=0
verify_one() {
  local file="$1"
  local expected
  expected=$(awk -v name="$2" '$2 == name { print $1 }' "$CHECKSUMS_LOCAL")
  if [[ -z "$expected" ]]; then
    echo "✗ no checksum recorded for $2"
    fail=$((fail + 1))
    return
  fi
  local actual
  actual=$(sha256sum "$file" | awk '{print $1}')
  if [[ "$expected" == "$actual" ]]; then
    echo "✓ $2 — $actual"
  else
    echo "✗ $2 — expected $expected, got $actual"
    fail=$((fail + 1))
  fi
}

verify_one "$ARTIFACT_DIR/voter_proof.wasm"      "voter_proof.wasm"
verify_one "$ARTIFACT_DIR/voter_proof.zkey"      "voter_proof.zkey"
verify_one "$ARTIFACT_DIR/verification_key.json" "verification_key.json"
verify_one "$VERIFIER_LOCAL"                      "Verifier.sol"

if [[ "$fail" -gt 0 ]]; then
  echo ""
  echo "✗ ${fail} artifact(s) do not match CHECKSUMS.txt — re-run sync:circuit." >&2
  exit 1
fi
echo ""
echo "✓ All 4 artifacts match the circuit-build CHECKSUMS.txt"
