/**
 * scripts/demo_rich.js — "rich timeline" visual demo for the dockerized node.
 *
 * Purpose
 * -------
 * The original `demo.js` does ONE successful vote — fine for a unit walkthrough
 * but produces almost no on-chain activity for an explorer GUI to render.
 * This script drives ~12+ visible transactions in mock mode against
 * `--network localhost`, designed to fill an Ethernal / Otterscan timeline:
 *
 *   1. Deploy MockVerifier
 *   2. Deploy VotingContract
 *   3. createElection
 *   4. addCandidate × 3 (Alice / Bruno / Carla)
 *   5. registerVoterHashes  (3 voters)
 *   6. setMerkleRoot
 *   7. openElection
 *   8. castVote × 3 (different signers, different choices)
 *   9. castVote replay  → reverts (NullifierAlreadyUsed)  ← visible failed tx
 *  10. closeElection
 *  11. Final tally print
 *
 * Mode
 * ----
 * Mock-only. The synced circuit was built with race_id=1 but the contract
 * pins POC_RACE_ID=0, so real-mode would revert. Once the circuit is rebuilt
 * with race_id=0, this script can be flipped to real mode trivially.
 *
 * Usage
 * -----
 *   docker compose --env-file .env.ethernal up -d
 *   cd pi-votacao-zk-blockchain
 *   npm run demo:rich        # uses --network localhost via the wrapper script
 */

"use strict";

const hre = require("hardhat");
const chalk = require("chalk");
const ora = require("ora");

// ── Visual helpers (kept minimal; demo.js has the fancy version) ───────────

const sep = (label = "") => {
  const line = "─".repeat(72);
  if (!label) return chalk.gray(line);
  const padded = ` ${label} `;
  const left = Math.floor((72 - padded.length) / 2);
  const right = 72 - padded.length - left;
  return chalk.gray("─".repeat(left)) + chalk.bold.cyan(padded) + chalk.gray("─".repeat(right));
};
const kv = (k, v, color = chalk.white) =>
  `  ${chalk.gray("•")} ${chalk.dim(k.padEnd(24))} ${color(v)}`;
const truncate = (s, n = 22) => {
  s = String(s);
  return s.length <= n ? s : `${s.slice(0, n - 3)}...`;
};

async function step(label, fn) {
  const spinner = ora({ text: label, color: "cyan" }).start();
  const t0 = Date.now();
  try {
    const result = await fn();
    spinner.succeed(`${label} ${chalk.gray(`(${Date.now() - t0}ms)`)}`);
    return result;
  } catch (err) {
    spinner.fail(`${label} ${chalk.red("FAILED")}`);
    throw err;
  }
}

// ── Poseidon Merkle tree (depth 4) — same shape as demo.js ─────────────────

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

  return {
    leaves: leaves.map((l) => F.toString(l)),
    root: F.toString(tree[DEPTH][0]),
    nullifierFor: (voterId, electionId, raceId) =>
      F.toString(poseidon([voterId, electionId, raceId])),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + sep("ZK VOTING — RICH TIMELINE DEMO (mock mode)"));
  console.log(`  ${chalk.bold("Network:")} ${chalk.white(hre.network.name)}\n`);

  const signers = await hre.ethers.getSigners();
  const admin = signers[0];
  const voters = [signers[1], signers[2], signers[3]];

  // Scenario
  const ELECTION_ID = 1n;
  const RACE_ID = 0n;
  const VOTER_CPFS = [11111111111n, 22222222222n, 33333333333n];
  const CANDIDATES = [
    { name: "Alice Oliveira", party: "PT", number: 13n },
    { name: "Bruno Silva",    party: "PSD", number: 45n },
    { name: "Carla Mendes",   party: "PV", number: 22n },
  ];
  // Choices: voter0→Alice, voter1→Bruno, voter2→Alice
  const CHOICES = [1n, 2n, 1n];

  console.log(sep("SCENARIO"));
  console.log(kv("Admin", admin.address, chalk.cyan));
  voters.forEach((v, i) =>
    console.log(kv(`Voter ${i + 1} wallet`, v.address, chalk.cyan)),
  );
  console.log(kv("Election ID", String(ELECTION_ID)));
  console.log(kv("Race ID (POC)", String(RACE_ID)));
  console.log(
    kv("Candidates", CANDIDATES.map((c) => `${c.name} (#${c.number})`).join("  /  ")),
  );
  console.log();

  // 1. Deploy MockVerifier
  console.log(sep("STEP 1 — DEPLOY MockVerifier"));
  const verifier = await step("Deploying MockVerifier", async () => {
    const F = await hre.ethers.getContractFactory("MockVerifier");
    const c = await F.deploy();
    await c.waitForDeployment();
    return c;
  });
  console.log(kv("Verifier address", await verifier.getAddress(), chalk.green));
  console.log();

  // 2. Deploy VotingContract
  console.log(sep("STEP 2 — DEPLOY VotingContract"));
  const voting = await step("Deploying VotingContract", async () => {
    const F = await hre.ethers.getContractFactory("VotingContract");
    const c = await F.deploy(await verifier.getAddress());
    await c.waitForDeployment();
    return c;
  });
  console.log(kv("VotingContract", await voting.getAddress(), chalk.green));
  console.log();

  // 3. createElection
  console.log(sep("STEP 3 — CREATE ELECTION + CANDIDATES"));
  await step("createElection()", () =>
    voting
      .createElection("Eleição PoC 2026 — Rich Demo", "Demo timeline para visualização")
      .then((tx) => tx.wait()),
  );
  for (const c of CANDIDATES) {
    await step(`addCandidate(${c.name}, #${c.number})`, () =>
      voting.addCandidate(c.name, c.party, c.number).then((tx) => tx.wait()),
    );
  }
  console.log();

  // 4. Build tree + register
  console.log(sep("STEP 4 — REGISTER VOTERS + MERKLE ROOT"));
  const tree = await step("Building Poseidon tree (3 voters, depth 4)", () =>
    buildPoseidonTree(VOTER_CPFS),
  );
  console.log(kv("Merkle root", truncate(tree.root), chalk.magenta));
  await step("registerVoterHashes([leaf0, leaf1, leaf2])", () =>
    voting.registerVoterHashes(tree.leaves.slice(0, 3)).then((tx) => tx.wait()),
  );
  await step("setMerkleRoot(root)", () =>
    voting.setMerkleRoot(tree.root).then((tx) => tx.wait()),
  );
  console.log();

  // 5. openElection
  console.log(sep("STEP 5 — OPEN ELECTION"));
  await step("openElection()", () =>
    voting.openElection().then((tx) => tx.wait()),
  );
  console.log(kv("State", "OPEN", chalk.green));
  console.log();

  // 6. castVote × 3
  console.log(sep("STEP 6 — CAST VOTES (3 voters)"));
  const votedPubSignals = []; // remembered for the replay step
  for (let i = 0; i < voters.length; i++) {
    const nullifier = tree.nullifierFor(VOTER_CPFS[i], ELECTION_ID, RACE_ID);
    const pubSignals = [
      BigInt(tree.root),
      BigInt(nullifier),
      CHOICES[i],
      ELECTION_ID,
      RACE_ID,
    ];
    const proofArr = Array(24).fill(0n);

    const receipt = await step(
      `Voter ${i + 1} → ${CANDIDATES[Number(CHOICES[i]) - 1].name}`,
      async () => {
        const tx = await voting
          .connect(voters[i])
          .castVote(RACE_ID, pubSignals, proofArr);
        return tx.wait();
      },
    );
    console.log(kv(`  tx`, receipt.hash, chalk.green));
    console.log(kv(`  gas`, receipt.gasUsed.toString(), chalk.yellow));
    votedPubSignals.push({ pubSignals, proofArr });
  }
  console.log();

  // 7. Replay attack → must revert
  console.log(sep("STEP 7 — REPLAY ATTACK (must revert)"));
  const replay = votedPubSignals[0];
  await step("Voter 1 tries to vote again (same nullifier)", async () => {
    try {
      const tx = await voting
        .connect(voters[0])
        .castVote(RACE_ID, replay.pubSignals, replay.proofArr);
      await tx.wait();
      throw new Error("UNEXPECTED: replay was accepted");
    } catch (err) {
      // Expected. Surface the revert reason if available.
      const msg = err.shortMessage || err.message || String(err);
      if (msg.includes("NullifierAlreadyUsed") || msg.includes("revert")) {
        console.log(kv("  reverted with", "NullifierAlreadyUsed", chalk.red));
        return;
      }
      throw err;
    }
  });
  console.log();

  // 8. closeElection
  console.log(sep("STEP 8 — CLOSE ELECTION"));
  await step("closeElection()", () =>
    voting.closeElection().then((tx) => tx.wait()),
  );
  console.log(kv("State", "FINISHED", chalk.yellow));
  console.log();

  // 9. Final tally
  console.log(sep("STEP 9 — FINAL ON-CHAIN TALLY"));
  const [resCandidates, resBlank, resNull, resTotal] = await voting.getResults();
  console.log(kv("Total votes", String(resTotal), chalk.bold.green));
  console.log(kv("Blank", String(resBlank)));
  console.log(kv("Null", String(resNull)));
  console.log();
  for (const c of resCandidates) {
    const bar = "█".repeat(Number(c.voteCount) * 4) || chalk.dim("·");
    console.log(
      `  ${chalk.cyan(`#${c.number}`)} ${c.name.padEnd(20)} ${chalk.green(bar)} ${chalk.bold(c.voteCount.toString())}`,
    );
  }
  console.log();

  const blockNumber = await hre.ethers.provider.getBlockNumber();
  console.log(sep("DONE"));
  console.log(kv("Final block number", String(blockNumber), chalk.bold.green));
  console.log(kv("Total successful txs", "≈12 (deploys + setup + 3 votes + close)", chalk.green));
  console.log(kv("Total failed txs", "1 (replay)", chalk.red));
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(chalk.red("\n✗ Rich demo failed:"));
    console.error(err);
    process.exit(1);
  });
