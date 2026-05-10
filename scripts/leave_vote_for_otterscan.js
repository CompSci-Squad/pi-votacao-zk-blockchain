/**
 * scripts/leave_vote_for_otterscan.js
 *
 * Deploys VotingContract + PlonkVerifier on the dockerized anvil
 * (default http://127.0.0.1:8545), runs through the happy-path lifecycle,
 * and leaves a single real-PLONK `VoteCast` transaction on chain so the
 * tx hash can be opened in Otterscan (http://localhost:5100) for the
 * article appendix screenshot.
 *
 * NO snapshot/revert — state persists for the lifetime of the anvil container.
 *
 * Pre-reqs:
 *   - `docker compose --profile viz up -d` from repo root
 *   - circuit artifacts synced (`npm run sync:circuit`)
 */
"use strict";

const path = require("node:path");
const { ethers } = require("ethers");

const {
  ensureAnvilReachable,
  resetAnvil,
  loadArtifact,
  getProvider,
  getWallets,
} = require("../test/integration/helpers/anvil");
const {
  artifactsAvailable,
  buildPoseidonTree,
  generateProof,
} = require("../test/integration/helpers/proof");
const { resetRepo, publishContract } = require("./publish_sourcify");

const ELECTION_ID = 1n;
const RACE_ID = 0n;
const VOTER_IDS = [12345678901n, 22222222222n, 33333333333n];
const CANDIDATE_ALICE = 1n;

async function main() {
  if (!artifactsAvailable()) {
    console.error("ZK artifacts missing. Run `npm run sync:circuit` first.");
    process.exit(1);
  }
  await ensureAnvilReachable();
  const provider = getProvider();
  await resetAnvil(provider);
  const wallets = getWallets(provider);
  const admin = wallets[0];

  const votingArtifact = loadArtifact("VotingContract.sol", "VotingContract");
  const verifierArtifact = loadArtifact("Verifier.sol", "PlonkVerifier");

  let nonce = await provider.getTransactionCount(admin.address, "latest");

  console.log("→ Deploying PlonkVerifier...");
  const Verifier = new ethers.ContractFactory(
    verifierArtifact.abi,
    verifierArtifact.bytecode,
    admin
  );
  const verifier = await Verifier.deploy({ nonce: nonce++ });
  await verifier.waitForDeployment();
  console.log("  PlonkVerifier @", await verifier.getAddress());

  console.log("→ Deploying VotingContract...");
  const Voting = new ethers.ContractFactory(
    votingArtifact.abi,
    votingArtifact.bytecode,
    admin
  );
  const voting = await Voting.deploy(await verifier.getAddress(), { nonce: nonce++ });
  await voting.waitForDeployment();
  const votingAddress = await voting.getAddress();
  console.log("  VotingContract @", votingAddress);

  console.log("→ Publishing source + metadata to local Sourcify repo...");
  resetRepo();
  const verifierPub = await publishContract({
    address: await verifier.getAddress(),
    chainId: 31337,
    artifactRel: "Verifier.sol/PlonkVerifier.json",
  });
  const votingPub = await publishContract({
    address: votingAddress,
    chainId: 31337,
    artifactRel: "VotingContract.sol/VotingContract.json",
  });
  console.log(`  PlonkVerifier   → ${verifierPub.sourcesCopied} source(s) published`);
  console.log(`  VotingContract  → ${votingPub.sourcesCopied} source(s) published`);

  console.log("→ Setting up election...");
  await (await voting.createElection("Eleicao Demo Otterscan", "Article appendix screenshot", { nonce: nonce++ })).wait();
  await (await voting.setRace0Name("Presidente", { nonce: nonce++ })).wait();
  await (await voting.addCandidate("Alice Oliveira", "PT", 13n, { nonce: nonce++ })).wait();
  await (await voting.addCandidate("Bruno Silva", "PSD", 45n, { nonce: nonce++ })).wait();

  const tree = await buildPoseidonTree(VOTER_IDS);
  const leafHashes = VOTER_IDS.map((_, i) => tree.leaves[i]);
  await (await voting.registerVoterHashes(leafHashes, { nonce: nonce++ })).wait();
  await (await voting.setMerkleRoot(tree.root, { nonce: nonce++ })).wait();
  await (await voting.openElection({ nonce: nonce++ })).wait();

  console.log("→ Generating real PLONK proof for voter 0 → Alice...");
  const { proofArr, pubSignals } = await generateProof({
    tree,
    voterIndex: 0,
    voterId: VOTER_IDS[0],
    electionId: ELECTION_ID,
    raceId: RACE_ID,
    candidateId: CANDIDATE_ALICE,
  });

  console.log("→ Submitting castVote...");
  const voter = wallets[1];
  const votingAsVoter = voting.connect(voter);
  const tx = await votingAsVoter.castVote(RACE_ID, pubSignals, proofArr);
  const receipt = await tx.wait();

  const block = await provider.getBlock(receipt.blockNumber);
  console.log("\n=========================================================");
  console.log("✓ Vote cast successfully");
  console.log("---------------------------------------------------------");
  console.log("  Tx hash       :", tx.hash);
  console.log("  Block number  :", receipt.blockNumber);
  console.log("  Block hash    :", block.hash);
  console.log("  From (voter)  :", voter.address);
  console.log("  Contract      :", votingAddress);
  console.log("  Gas used      :", receipt.gasUsed.toString());
  console.log("  Logs (events) :", receipt.logs.length);
  console.log("---------------------------------------------------------");
  console.log("Otterscan URLs:");
  console.log("  Tx     : http://localhost:5100/tx/" + tx.hash);
  console.log("  Block  : http://localhost:5100/block/" + receipt.blockNumber);
  console.log("  Voter  : http://localhost:5100/address/" + voter.address);
  console.log("  Voting : http://localhost:5100/address/" + votingAddress);
  console.log("=========================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
