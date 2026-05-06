# Session report — multi-race PoC + BU/Zerésima/RDV + audit + dashboard

**Date (UTC):** 2026-05-06
**Scope:** integration root (`pi_votacao/`) + `pi-votacao-zk-blockchain/`
**Circuits repo (`pi-votacao-zk-circuits/`):** UNTOUCHED — boundary preserved.

---

## 1. Executive summary

This session extends the verifiable anonymous voting PoC from a single-race
prototype to a **3-cargo / 3-candidatos** election compatible with the
Brazilian electoral process (TSE), without breaking any pre-existing test or
the circuit-↔-contract boundary.

Delivered:

| Track | Outcome |
|---|---|
| **Multi-race contract** | `VotingContract.sol` now supports 1 implicit race (race 0, legacy slate) + N additional races via `addRace` / `addCandidateToRace`. **All 66 forge tests pass.** |
| **Integration coverage** | 10 legacy scenarios still green + 3 new multi-race scenarios. **13 / 13 passing** with real PLONK proofs against real `PlonkVerifier`. |
| **Brazilian-style audit reports** | On-chain views `getZeresimaMultiRace()` and `getBoletimUrna()` plus offline scripts that produce **SHA-256-stamped JSON + Markdown** for *Zerésima*, *Boletim de Urna* and *Registro Digital do Voto* (RDV). |
| **Static analysis** | Solhint clean (0 errors, 89 cosmetic warnings); gas report attached; Slither documented as deferred. |
| **Visualization** | `viz/dashboard.html` — single-file live dashboard, ethers via CDN, polls anvil every 2 s, renders state + race cards + VoteCast tail. |
| **End-to-end demo** | `scripts/reports/run_e2e_demo.js` deploys, sets up, casts 9 ballots, closes, and emits all 3 reports. ✅ ran. |
| **Boundary** | `voter_proof.circom`, `voter_proof.zkey` (`e338ebdc…`), `Verifier.sol` (`fe24c84d…`) — **unchanged**. |

---

## 2. Files changed / added

### Contract

- `pi-votacao-zk-blockchain/src/VotingContract.sol`
  - Removed `POC_RACE_ID = 0` constant.
  - New state: `string public race0Name`, `mapping(uint256 => Race) internal extraRaces`, `uint256 public extraRacesCount`.
  - New `Race` struct with name + candidates + counters; race 0 keeps its legacy storage to preserve the existing test surface.
  - New admin (PENDING-only): `setRace0Name`, `addRace`, `addCandidateToRace`, `racesCount`.
  - New views: `getRaceName`, `getRaceResults`, `getCandidatesByRace`, `getZeresimaMultiRace`, `getBoletimUrna`.
  - `castVote` now accepts any `raceId ∈ [0, extraRacesCount]` with revert ordering preserved (`InvalidRaceId → InvalidMerkleRoot → InvalidElectionId → RaceIdMismatch → NullifierAlreadyUsed → InvalidProof`).
  - Emits new events: `RaceAdded`, `Race0Named`, `CandidateAddedToRace`.

### Tests

- `pi-votacao-zk-blockchain/test/integration/e2e_real_proof.test.js` — added 3 multi-race scenarios:
  - **multi-race happy path** — same voter casts in 3 races → 3 distinct nullifiers, 3 `VoteCast` events.
  - **cross-race nullifier isolation** — `nullifiers[raceId][n]` independent across races; explicit nonce threading required for back-to-back txs from the same wallet.
  - **invalid raceId** — `castVote(99, ...)` reverts with `InvalidRaceId`.
- `pi-votacao-zk-blockchain/test/unit/Deployment.t.sol` — replaced `POC_RACE_ID` constant assertion with `racesCount() == 1` and `extraRacesCount() == 0`.

### Reports

- `pi-votacao-zk-blockchain/scripts/reports/lib.js` — provider, ABI loader, canonical-JSON SHA-256 stamping, atomic JSON+MD writers.
- `pi-votacao-zk-blockchain/scripts/reports/generate_zeresima.js` — Zerésima (PENDING-only); fails with exit 2 if any counter ≠ 0.
- `pi-votacao-zk-blockchain/scripts/reports/generate_bu.js` — Boletim de Urna; works in any state, includes `state` and `grandTotalVotes`.
- `pi-votacao-zk-blockchain/scripts/reports/generate_rdv.js` — Registro Digital do Voto; sorts ballots by `keccak256(nullifier ‖ raceId)` for order-independence.
- `pi-votacao-zk-blockchain/scripts/reports/run_e2e_demo.js` — orchestrator that deploys, casts 9 ballots and emits all three reports.

### Audit + visualization

- `pi-votacao-zk-blockchain/.solhint.json` — Solhint config tuned for OpenZeppelin remappings.
- `pi-votacao-zk-blockchain/reports/audit/{solhint.txt, gas_report.txt, SUMMARY.md}` — static analysis artifacts.
- `viz/dashboard.html` — single-file dashboard (ethers v6 via CDN, no build).

---

## 3. Test results

### 3.1 Forge (Foundry) — `forge test --gas-report`

```
Ran 9 test suites in 1.03s (3.06s CPU time): 66 tests passed, 0 failed, 0 skipped (66 total tests)
```

Full output: [`pi-votacao-zk-blockchain/reports/audit/gas_report.txt`](../pi-votacao-zk-blockchain/reports/audit/gas_report.txt).

### 3.2 Integration (Mocha + ethers + anvil) — `npm run test:integration`

```
Integration: real PLONK proof → on-chain castVote
  ✔ happy path
  ✔ double vote
  ✔ relay attack (RaceIdMismatch)
  ✔ wrong merkle root
  ✔ wrong election id
  ✔ invalid proof bytes
  ✔ election state guard
  ✔ blank vote
  ✔ null vote
  ✔ results audit
  ✔ multi-race happy path
  ✔ cross-race nullifier isolation
  ✔ invalid raceId
13 passing (1m)
```

Full output: `/tmp/integration_final.log` (preserved on the host running the session).

### 3.3 Demo run — `node scripts/reports/run_e2e_demo.js`

```
[demo] voting=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
[demo]  ✔ 9 ballots across 3 races (3 voters × 3 races)
[zeresima] sha256=5da1d90af612d7626fe2dfc24d5d29a36d0a47850916292e281d3315e6a03af7
[bu]       sha256=b97bdbb2b4b5f53aa7532f01dc21e5c9524e4f17efe67f25c6b2e3b5fc9460b7
[rdv]      sha256=8335cca95611b3fddabf2ffcab2b6274206a224f08c3b8fc3a4042efa8f5895c (9 ballots)
```

Resulting BU (excerpt) — final tallies match the demo plan exactly:

| Cargo | Resultado |
|---|---|
| **0 — Presidente** | Alice 1, Bruno 1, Brancos 0, Nulos 1 (total 3) |
| **1 — Governador** | Eduarda 2, Carla 1, Daniel 0 (total 3) |
| **2 — Senador** | Gabriela 1, Henrique 1, Fernando 0, Branco 1 (total 3) |

---

## 4. Static analysis

| Tool | Result |
|---|---|
| **Solhint 6.2.1** | ✅ 0 errors, 89 cosmetic warnings (NatSpec / gas hints). |
| **forge gas-report** | ✅ 66 tests, gas costs documented. `castVote` ≈ 95 k–410 k gas depending on storage warmth. |
| **Slither** | ⚠️ Deferred — host env lacks `pip` for active Python; commit blocks no other deliverable. Recommended: `pipx install slither-analyzer && slither src/VotingContract.sol --filter-paths "lib/|test/" --solc-remaps "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/" --checklist`. |

Full breakdown: [`pi-votacao-zk-blockchain/reports/audit/SUMMARY.md`](../pi-votacao-zk-blockchain/reports/audit/SUMMARY.md).

---

## 5. Boundary invariants — preserved

| Invariant | Status |
|---|---|
| 5 public signals `[merkle_root, nullifier_hash, candidate_id, election_id, race_id]` | ✅ |
| `nullifier = Poseidon(voter_id, election_id, race_id)` | ✅ |
| Revert priority `InvalidRaceId → InvalidMerkleRoot → InvalidElectionId → RaceIdMismatch → NullifierAlreadyUsed → InvalidProof` | ✅ |
| `voter_proof.zkey` SHA-256 = `e338ebdcd39fe4a27d5bf62d423df93df186b3603165340e95024e4be66e0255` | ✅ unchanged |
| `Verifier.sol` SHA-256 = `fe24c84d00fecee466cf0cb39e824e43af781877e47cbe104aa1e06f063d6944` | ✅ unchanged |
| Strict CEI in `castVote` | ✅ |

The circuit repo (`pi-votacao-zk-circuits/`) was not touched in this session.

---

## 6. Open items / deferred

- **Slither**: install via `pipx`/distribution package, then re-run; expected to add no high-severity findings (no `delegatecall`, no upgradeability, no assembly, no token transfers).
- **docker-compose visualization stack**: still TODO per root copilot-instructions §5. Current `viz/dashboard.html` covers the demo-time observation need without a compose layer.
- **Persistent live demo server**: dashboard is file-served; for a polished defense, a tiny static-file server in compose alongside anvil + an explorer like Otterscan would help. Not blocking.
- **NatSpec polish**: 89 Solhint warnings are mostly missing `@notice` / `@param` tags. Cosmetic; non-blocking.

---

## 7. How to reproduce

```bash
# Spin up anvil
docker compose up -d anvil

# In pi-votacao-zk-blockchain/
forge build
forge test --gas-report                              # 66 / 66
npm run test:integration                             # 13 / 13

# End-to-end demo + reports
node scripts/reports/run_e2e_demo.js                 # → reports/runtime/

# Open dashboard
xdg-open ../viz/dashboard.html
# paste the address printed by run_e2e_demo (also written to .voting_addr)
```

---

*This report is signed by SHA-256 of the runtime artifacts above. Each runtime
JSON is independently re-verifiable: recompute the canonical-JSON SHA-256 of
the JSON minus its `_integrity` field and compare with the value embedded in
the file.*
