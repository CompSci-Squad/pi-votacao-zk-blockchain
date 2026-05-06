# Static analysis — pi-votacao-zk-blockchain

Date: 2026-05-05 (UTC)

## Tools executed

| Tool | Version | Status | Output |
|------|---------|--------|--------|
| `solhint` | 6.2.1 (via `npx --yes solhint@6`) | ✅ ran | [`solhint.txt`](./solhint.txt) |
| `forge test --gas-report` | foundry stable | ✅ ran (66/66 pass) | [`gas_report.txt`](./gas_report.txt) |
| `slither` | n/a | ⚠️ skipped — no sudo / pipx in CI environment; `pip install --user slither-analyzer` did not place a binary on `PATH` (system Python lacks `pip`). Documented as deferred. |

## Summary

### Solhint
- **0 errors**, **89 warnings**.
- All warnings are NatSpec-style (`use-natspec`) or gas-style hints (`gas-increment-by-one`, `gas-strict-inequalities`, `gas-indexed-events`).
- **No correctness or security findings.**
- The `import-path-check` warning on `@openzeppelin/contracts/utils/ReentrancyGuard.sol` is a false positive — the path is provided through Foundry's `remappings.txt`, which Solhint does not consult. Foundry compiles cleanly.

### Gas report
- All 66 Foundry tests pass.
- `castVote` ranges from **~95k gas** (warm) up to **~410k gas** for first-vote-in-a-race (storage zero→nonzero on counter slots). See full table in `gas_report.txt`.
- `addRace` / `addCandidateToRace` are PENDING-only one-shot setup costs.

### Deferred — Slither
Slither was not run because the host environment does not expose `pip` for the active Python and `pipx` is unavailable.  Recommended invocation when the environment supports it:

```bash
pipx install slither-analyzer
slither src/VotingContract.sol \
    --solc-remaps "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/" \
    --filter-paths "lib/|test/" \
    --checklist > reports/audit/slither.md
```

The contract is small (≈700 lines, 1 inherit), uses checks-effects-interactions strictly, and has no `delegatecall`, no `selfdestruct`, no upgradeability, no assembly, and no external token transfers — the surface that Slither typically finds high-severity issues on is not present here.  Running Slither remains a recommended next step but is **not blocking** for this PoC milestone.

## Boundary invariants — preserved

- `voter_proof.zkey` SHA-256 unchanged: `e338ebdcd39fe4a27d5bf62d423df93df186b3603165340e95024e4be66e0255`
- `Verifier.sol` SHA-256 unchanged: `fe24c84d00fecee466cf0cb39e824e43af781877e47cbe104aa1e06f063d6944`
- 5 public-signal layout `[merkle_root, nullifier_hash, candidate_id, election_id, race_id]` unchanged.
- `nullifier = Poseidon(voter_id, election_id, race_id)` unchanged.
