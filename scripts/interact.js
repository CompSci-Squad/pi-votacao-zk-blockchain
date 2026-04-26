/**
 * interact.js — Example interaction script for VotingContract.
 *
 * Usage:
 *   VOTING_ADDRESS=0x... npx hardhat run scripts/interact.js --network localhost
 *   VOTING_ADDRESS=0x... npx hardhat run scripts/interact.js --network sepolia
 *
 * Demonstrates the full lifecycle of an election:
 *   1. createElection
 *   2. addCandidate (×2)
 *   3. registerVoterHashes
 *   4. setMerkleRoot
 *   5. openElection
 *   6. getZeresima (confirm zero votes)
 *   7. castVote   (placeholder PLONK proof — replace with a real proof in production)
 *   8. closeElection
 *   9. getResults
 */
const hre = require("hardhat");
const { ethers } = hre;

const VOTING_ADDRESS = process.env.VOTING_ADDRESS;
if (!VOTING_ADDRESS) {
  throw new Error("Please set the VOTING_ADDRESS environment variable.");
}

// PoC: single race, race_id always 0
const POC_RACE_ID = 0n;

/**
 * Build a dummy PLONK proof accepted by MockVerifier only.
 * Replace with a real snarkjs-generated proof in production.
 *
 * Public signals MUST follow the canonical order set by voter_proof.circom:
 *   [0] merkle_root
 *   [1] nullifier_hash
 *   [2] candidate_id
 *   [3] election_id
 *   [4] race_id
 */
function dummyProof({ merkleRoot, nullifier, candidateId, electionId, raceId }) {
  return {
    // 24 zero field elements — accepted by MockVerifier only.
    proof: Array(24).fill(0n),
    pubSignals: [
      BigInt(merkleRoot),
      BigInt(nullifier),
      BigInt(candidateId),
      BigInt(electionId),
      BigInt(raceId),
    ],
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);

  const voting = await ethers.getContractAt("VotingContract", VOTING_ADDRESS);

  // ── 1. Create election ──────────────────────────────────────────────────
  console.log("\n1. Creating election...");
  let tx = await voting.createElection(
    "Eleicao Academica 2025",
    "Eleicao de prova-de-conceito com ZK-SNARKs"
  );
  await tx.wait();
  console.log("   Election:", await voting.electionName());
  console.log("   ID      :", (await voting.currentElectionId()).toString());

  // ── 2. Add candidates ───────────────────────────────────────────────────
  console.log("\n2. Adding candidates...");
  tx = await voting.addCandidate("Alice", "Partido A", 10);
  await tx.wait();
  tx = await voting.addCandidate("Bob", "Partido B", 20);
  await tx.wait();
  console.log("   Candidates:", (await voting.getCandidateCount()).toString());

  // ── 3. Register voter hashes ────────────────────────────────────────────
  console.log("\n3. Registering voter hashes...");
  const hashes = Array.from({ length: 15 }, (_, i) =>
    BigInt(ethers.keccak256(ethers.toUtf8Bytes(`voter_${i}`)))
  );
  tx = await voting.registerVoterHashes(hashes);
  await tx.wait();
  console.log("   Hashes registered:", hashes.length);

  // ── 4. Set Merkle root ──────────────────────────────────────────────────
  console.log("\n4. Setting Merkle root...");
  // In production, compute this from the actual Merkle tree of voter hashes.
  const merkleRoot = BigInt(
    ethers.keccak256(ethers.toUtf8Bytes("merkle_root_placeholder"))
  );
  tx = await voting.setMerkleRoot(merkleRoot);
  await tx.wait();
  console.log("   Merkle root:", (await voting.voterMerkleRoot()).toString());

  // ── 5. Open election ────────────────────────────────────────────────────
  console.log("\n5. Opening election...");
  tx = await voting.openElection();
  await tx.wait();
  console.log("   State:", (await voting.state()).toString(), "(1 = OPEN)");

  // ── 6. Zerésima ─────────────────────────────────────────────────────────
  console.log("\n6. Cannot call getZeresima after open — skipping.");

  // ── 7. Cast a vote ──────────────────────────────────────────────────────
  console.log("\n7. Casting vote (dummy proof — MockVerifier only)...");
  const electionId = await voting.currentElectionId();
  const proof = dummyProof({
    merkleRoot,
    nullifier: 12345n,
    candidateId: 1n,        // Alice
    electionId,
    raceId: POC_RACE_ID,
  });
  tx = await voting.castVote(POC_RACE_ID, proof.pubSignals, proof.proof);
  await tx.wait();
  console.log("   Vote cast.");

  // ── 8. Close election ───────────────────────────────────────────────────
  console.log("\n8. Closing election...");
  tx = await voting.closeElection();
  await tx.wait();
  console.log("   State:", (await voting.state()).toString(), "(2 = FINISHED)");

  // ── 9. Get results ──────────────────────────────────────────────────────
  console.log("\n9. Results:");
  const r = await voting.getResults();
  for (const c of r._candidates) {
    console.log(`   [${c.number}] ${c.name} (${c.party}): ${c.voteCount} vote(s)`);
  }
  console.log("   Blank votes :", r._blankVotes.toString());
  console.log("   Null votes  :", r._nullVotes.toString());
  console.log("   Total votes :", r._totalVotes.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
