/**
 * scripts/demo.js — End-to-end visual demo of the ZK voting flow.
 *
 * Walks through a full election lifecycle on a fresh Hardhat in-process node:
 *   1. Deploy verifier (real or mock — auto-detected)
 *   2. Deploy VotingContract
 *   3. Create election + add 2 candidates
 *   4. Build Merkle tree of 1 voter (depth 4) — Poseidon
 *   5. Register voter hashes + Merkle root
 *   6. Open election + zerésima
 *   7. Generate ZK proof (real PLONK if artifacts present, else mock pubSignals)
 *   8. Cast vote on-chain
 *   9. Show on-chain tally + emitted VoteCast event
 *
 * Usage:
 *   npm run demo           — mock mode (always works)
 *   npm run demo:real      — real PLONK proof (requires synced artifacts)
 *
 * Mode auto-detection: if DEMO_MODE !== "real" but artifacts exist, stays in
 * mock mode (explicit opt-in for real proofs to keep CI fast and predictable).
 *
 * NOTE: artifacts are expected at scripts/artifacts/{voter_proof.wasm,
 * voter_proof.zkey, verification_key.json, Verifier.sol} — populate via
 *   npm run sync:circuit
 *
 * KNOWN MISMATCH: the circuit currently uses race_id = 1, but the contract
 * pins POC_RACE_ID = 0. Real-mode demos will revert with RaceIdMismatch
 * until the circuit is regenerated with race_id = 0 (tracked in SESSION_LOG).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const chalk = require("chalk");
const ora = require("ora");

const ARTIFACTS_DIR = path.join(__dirname, "artifacts");
const WASM_PATH = path.join(ARTIFACTS_DIR, "voter_proof.wasm");
const ZKEY_PATH = path.join(ARTIFACTS_DIR, "voter_proof.zkey");
const VKEY_PATH = path.join(ARTIFACTS_DIR, "verification_key.json");

// ── Visual helpers ───────────────────────────────────────────────────────────

const sep = (label = "") => {
  const line = "─".repeat(72);
  if (!label) return chalk.gray(line);
  const padded = ` ${label} `;
  const left = Math.floor((72 - padded.length) / 2);
  const right = 72 - padded.length - left;
  return chalk.gray("─".repeat(left)) + chalk.bold.cyan(padded) + chalk.gray("─".repeat(right));
};

const kv = (k, v, color = chalk.white) =>
  `  ${chalk.gray("•")} ${chalk.dim(k.padEnd(22))} ${color(v)}`;

const truncate = (s, n = 22) => {
  s = String(s);
  return s.length <= n ? s : `${s.slice(0, n - 3)}...`;
};

async function step(label, fn) {
  const spinner = ora({ text: label, color: "cyan" }).start();
  const t0 = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    spinner.succeed(`${label} ${chalk.gray(`(${ms}ms)`)}`);
    return result;
  } catch (err) {
    spinner.fail(`${label} ${chalk.red("FAILED")}`);
    throw err;
  }
}

// ── Mode detection ───────────────────────────────────────────────────────────

function detectMode() {
  const requested = (process.env.DEMO_MODE || "mock").toLowerCase();
  const haveArtifacts =
    fs.existsSync(WASM_PATH) &&
    fs.existsSync(ZKEY_PATH) &&
    fs.existsSync(VKEY_PATH);
  if (requested === "real" && !haveArtifacts) {
    console.log(chalk.red(`\n✗ DEMO_MODE=real but ZK artifacts missing under ${ARTIFACTS_DIR}`));
    console.log(chalk.yellow(`  Run: npm run sync:circuit`));
    process.exit(1);
  }
  return { mode: requested === "real" ? "real" : "mock", haveArtifacts };
}

// ── Merkle helpers (Poseidon, depth 4, matches circuit) ──────────────────────

async function buildPoseidonTree(voterIds) {
  const { buildPoseidon } = require("circomlibjs");
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const DEPTH = 4;
  const SIZE = 1 << DEPTH;

  const leaves = voterIds.map((id) => poseidon([id]));
  const padded = leaves.slice();
  while (padded.length < SIZE) padded.push(F.zero);

  const tree = [padded];
  let level = padded;
  for (let d = 0; d < DEPTH; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(poseidon([level[i], level[i + 1]]));
    }
    tree.push(next);
    level = next;
  }

  const proofFor = (idx) => {
    const pathElements = [];
    const pathIndices = [];
    let cur = idx;
    for (let d = 0; d < DEPTH; d++) {
      const sib = cur % 2 === 0 ? cur + 1 : cur - 1;
      pathElements.push(F.toString(tree[d][sib]));
      pathIndices.push(cur % 2);
      cur = Math.floor(cur / 2);
    }
    return { pathElements, pathIndices };
  };

  return {
    poseidon,
    F,
    leaves: leaves.map((l) => F.toString(l)),
    root: F.toString(tree[DEPTH][0]),
    nullifierFor: (voterId, electionId, raceId) =>
      F.toString(poseidon([voterId, electionId, raceId])),
    proofFor,
  };
}

// ── Main demo ────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + sep("ZK VOTING — END-TO-END DEMO"));

  const { mode } = detectMode();
  console.log(
    `  ${chalk.bold("Mode:")} ${mode === "real" ? chalk.green("REAL PLONK PROOF") : chalk.yellow("MOCK (always-true verifier)")}`,
  );
  console.log(`  ${chalk.bold("Network:")} ${chalk.white(hre.network.name)}\n`);

  const [admin, voter] = await hre.ethers.getSigners();

  // ── Scenario data ──────────────────────────────────────────────────────
  const ELECTION_ID = 1n;
  const RACE_ID = 0n; // POC_RACE_ID
  const VOTER_CPF = 12345678901n;
  const CANDIDATES = [
    { name: "Alice Oliveira", party: "PT", number: 13n },
    { name: "Bruno Silva", party: "PSD", number: 45n },
  ];
  const VOTE_FOR = 1n; // candidate id 1 (Alice)

  console.log(sep("SCENARIO"));
  console.log(kv("Admin", admin.address, chalk.cyan));
  console.log(kv("Voter wallet", voter.address, chalk.cyan));
  console.log(kv("Voter CPF (private)", String(VOTER_CPF), chalk.magenta));
  console.log(kv("Election ID", String(ELECTION_ID)));
  console.log(kv("Race ID (POC)", String(RACE_ID)));
  console.log(kv("Candidates", `${CANDIDATES[0].name} (#13)  vs  ${CANDIDATES[1].name} (#45)`));
  console.log(kv("Voting for", `Candidate ${VOTE_FOR} — ${CANDIDATES[Number(VOTE_FOR) - 1].name}`, chalk.green));
  console.log();

  // ── 1. Deploy verifier ────────────────────────────────────────────────
  console.log(sep("STEP 1 — DEPLOY VERIFIER"));
  const verifier = await step(
    `Deploying ${mode === "real" ? "PlonkVerifier (real PLONK)" : "MockVerifier (always-true)"}`,
    async () => {
      const name = mode === "real" ? "PlonkVerifier" : "MockVerifier";
      const Factory = await hre.ethers.getContractFactory(name);
      const c = await Factory.deploy();
      await c.waitForDeployment();
      return c;
    },
  );
  console.log(kv("Verifier address", await verifier.getAddress(), chalk.green));
  console.log();

  // ── 2. Deploy VotingContract ──────────────────────────────────────────
  console.log(sep("STEP 2 — DEPLOY VOTING CONTRACT"));
  const voting = await step("Deploying VotingContract", async () => {
    const Factory = await hre.ethers.getContractFactory("VotingContract");
    const c = await Factory.deploy(await verifier.getAddress());
    await c.waitForDeployment();
    return c;
  });
  console.log(kv("VotingContract", await voting.getAddress(), chalk.green));
  console.log(kv("Initial state", "PENDING", chalk.yellow));
  console.log();

  // ── 3. Election setup ─────────────────────────────────────────────────
  console.log(sep("STEP 3 — CREATE ELECTION"));
  await step("createElection()", () =>
    voting.createElection("Eleição PoC 2026", "Demonstração end-to-end").then((tx) => tx.wait()),
  );
  for (const c of CANDIDATES) {
    await step(`addCandidate(${c.name}, #${c.number})`, () =>
      voting.addCandidate(c.name, c.party, c.number).then((tx) => tx.wait()),
    );
  }
  console.log();

  // ── 4. Build Merkle tree + nullifier ──────────────────────────────────
  console.log(sep("STEP 4 — BUILD MERKLE TREE (Poseidon, depth 4)"));
  const tree = await step("Hashing voter + computing Poseidon root", () =>
    buildPoseidonTree([VOTER_CPF]),
  );
  const nullifierHash = tree.nullifierFor(VOTER_CPF, ELECTION_ID, RACE_ID);
  console.log(kv("Voter leaf hash", truncate(tree.leaves[0]), chalk.magenta));
  console.log(kv("Merkle root", truncate(tree.root), chalk.magenta));
  console.log(kv("Nullifier hash", truncate(nullifierHash), chalk.red));
  console.log(`  ${chalk.dim("(formula: Poseidon(voter_id, election_id, race_id))")}\n`);

  // ── 5. Register hashes + root ─────────────────────────────────────────
  console.log(sep("STEP 5 — REGISTER VOTER SET ON-CHAIN"));
  await step("registerVoterHashes([leaf0])", () =>
    voting.registerVoterHashes([tree.leaves[0]]).then((tx) => tx.wait()),
  );
  await step("setMerkleRoot(root)", () =>
    voting.setMerkleRoot(tree.root).then((tx) => tx.wait()),
  );
  console.log();

  // ── 6. Open election + zerésima ───────────────────────────────────────
  console.log(sep("STEP 6 — OPEN ELECTION + ZERÉSIMA"));
  const zeresima = await voting.getZeresima();
  console.log(kv("Zerésima allZero?", String(zeresima[3]), chalk.green));
  console.log(kv("Zerésima voterCount", String(zeresima[2])));
  console.log(kv("Zerésima blockNumber", String(zeresima[5])));
  await step("openElection()", () =>
    voting.openElection().then((tx) => tx.wait()),
  );
  console.log(kv("New state", "OPEN", chalk.green));
  console.log();

  // ── 7. Generate proof ─────────────────────────────────────────────────
  console.log(sep("STEP 7 — GENERATE PROOF"));
  let proofArr;   // uint256[24]
  let pubSignals; // uint256[5]

  if (mode === "real") {
    const snarkjs = require("snarkjs");
    const { pathElements, pathIndices } = tree.proofFor(0);
    const input = {
      voter_id: String(VOTER_CPF),
      race_id: String(RACE_ID),
      merkle_path: pathElements,
      merkle_path_indices: pathIndices,
      merkle_root: tree.root,
      nullifier_hash: nullifierHash,
      candidate_id: String(VOTE_FOR),
      election_id: String(ELECTION_ID),
    };
    const result = await step("snarkjs.plonk.fullProve(...)", () =>
      snarkjs.plonk.fullProve(input, WASM_PATH, ZKEY_PATH),
    );
    // snarkjs PLONK Solidity ABI: verifyProof(uint256[24] proof, uint256[5] pubSignals).
    // exportSolidityCallData returns two adjacent JSON arrays "[..24..][..5..]".
    // Insert a comma between them so it parses as a single 2-element array.
    const parsed = await step("Encoding proof for PlonkVerifier ABI", async () => {
      const calldata = await snarkjs.plonk.exportSolidityCallData(
        result.proof,
        result.publicSignals,
      );
      return JSON.parse(`[${calldata.replace("][", "],[")}]`);
    });
    proofArr   = parsed[0].map((x) => BigInt(x));
    pubSignals = parsed[1].map((x) => BigInt(x));
    console.log(kv("Proof elements", String(proofArr.length), chalk.green));
  } else {
    proofArr = Array(24).fill(0n);
    pubSignals = [
      BigInt(tree.root),
      BigInt(nullifierHash),
      VOTE_FOR,
      ELECTION_ID,
      RACE_ID,
    ];
    console.log(`  ${chalk.dim("(mock mode — fabricated pubSignals, MockVerifier always returns true)")}`);
  }
  console.log(kv("pubSignals[0] merkle_root", truncate(pubSignals[0])));
  console.log(kv("pubSignals[1] nullifier", truncate(pubSignals[1]), chalk.red));
  console.log(kv("pubSignals[2] candidate_id", String(pubSignals[2]), chalk.green));
  console.log(kv("pubSignals[3] election_id", String(pubSignals[3])));
  console.log(kv("pubSignals[4] race_id", String(pubSignals[4])));
  console.log();

  // ── 8. Cast vote ──────────────────────────────────────────────────────
  console.log(sep("STEP 8 — CAST VOTE ON-CHAIN"));
  const receipt = await step("voting.castVote(raceId, pubSignals, proof)", async () => {
    const tx = await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr);
    return tx.wait();
  });
  console.log(kv("Tx hash", receipt.hash, chalk.green));
  console.log(kv("Gas used", receipt.gasUsed.toString(), chalk.yellow));

  const voteCastLog = receipt.logs
    .map((l) => {
      try {
        return voting.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "VoteCast");
  if (voteCastLog) {
    console.log(`  ${chalk.gray("•")} ${chalk.dim("Event VoteCast emitted:")}`);
    console.log(kv("    nullifier (idx)", truncate(voteCastLog.args[0]), chalk.red));
    console.log(kv("    raceId    (idx)", String(voteCastLog.args[1])));
    console.log(kv("    candidate (idx)", String(voteCastLog.args[2]), chalk.green));
  }
  console.log();

  // ── 9. Final tally ────────────────────────────────────────────────────
  console.log(sep("STEP 9 — FINAL ON-CHAIN TALLY"));
  const [resCandidates, resBlank, resNull, resTotal] = await voting.getResults();
  console.log(kv("Total votes", String(resTotal), chalk.bold.green));
  console.log(kv("Blank votes", String(resBlank)));
  console.log(kv("Null  votes", String(resNull)));
  console.log();
  for (const c of resCandidates) {
    const bar = "█".repeat(Number(c.voteCount) * 4) || chalk.dim("·");
    console.log(
      `  ${chalk.cyan(`#${c.number}`)} ${c.name.padEnd(20)} ${chalk.green(bar)} ${chalk.bold(c.voteCount.toString())}`,
    );
  }
  const used = await voting.isNullifierUsed(RACE_ID, pubSignals[1]);
  console.log();
  console.log(kv("Nullifier marked used?", String(used), used ? chalk.green : chalk.red));

  console.log("\n" + sep("DONE") + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(chalk.red("\n✗ Demo failed:"));
    console.error(err);
    process.exit(1);
  });
