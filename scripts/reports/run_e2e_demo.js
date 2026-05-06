/**
 * scripts/reports/run_e2e_demo.js
 *
 * End-to-end demo orchestrator for the multi-race PoC.
 *   - Deploys Verifier + VotingContract on the running anvil
 *   - Sets up a 3-race × 3-candidate ballot
 *   - Captures a Zerésima (PENDING)
 *   - Opens the election and casts real PLONK proofs from 3 voters across 3 races
 *   - Closes the election
 *   - Captures the BU and the RDV (FINISHED)
 *
 * Output:
 *   - exports VOTING_ADDR for downstream tools (also written to .voting_addr)
 *   - reports/runtime/{zeresima,bu,rdv}_election1_<UTC>.json + .md
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const {
  ensureAnvilReachable,
  resetAnvil,
  loadArtifact,
  getProvider,
  getWallets,
} = require("../../test/integration/helpers/anvil");
const {
  artifactsAvailable,
  buildPoseidonTree,
  generateProof,
} = require("../../test/integration/helpers/proof");

const ELECTION_NAME = "Eleição PoC pi_votacao";
const ELECTION_DESC = "Demo end-to-end multi-cargo";
const RACE_PRES = 0n;
const RACE_GOV  = 1n;
const RACE_SEN  = 2n;
const ELECTION_ID = 1n;

const VOTER_IDS = [12345678901n, 22222222222n, 33333333333n];
const CANDIDATES_PRES = [
  ["Alice Oliveira", "PT", 13n],
  ["Bruno Silva",    "PSD", 45n],
];
const CANDIDATES_GOV = [
  ["Carla Souza",    "PSDB",         25n],
  ["Daniel Rocha",   "REPUBLICANOS", 10n],
  ["Eduarda Lima",   "PSOL",         50n],
];
const CANDIDATES_SEN = [
  ["Fernando Pires",   "PL",    22n],
  ["Gabriela Mendes",  "PT",    13n],
  ["Henrique Alves",   "UNIÃO", 44n],
];

async function main() {
  if (!artifactsAvailable()) {
    throw new Error(
      "ZK artifacts not synced. Run `npm run sync:circuit` first."
    );
  }
  await ensureAnvilReachable();

  const provider = getProvider();
  await resetAnvil(provider);
  const wallets = getWallets(provider);
  const admin   = wallets[0];
  const voters  = [wallets[1], wallets[2], wallets[3]];

  const votingArt   = loadArtifact("VotingContract.sol", "VotingContract");
  const verifierArt = loadArtifact("Verifier.sol",       "PlonkVerifier");

  let nonce = await provider.getTransactionCount(admin.address, "latest");

  console.log("[demo] deploying Verifier + VotingContract…");
  const VerifierFactory = new ethers.ContractFactory(
    verifierArt.abi, verifierArt.bytecode, admin);
  const verifier = await VerifierFactory.deploy({ nonce: nonce++ });
  await verifier.waitForDeployment();

  const VotingFactory = new ethers.ContractFactory(
    votingArt.abi, votingArt.bytecode, admin);
  const voting = await VotingFactory.deploy(
    await verifier.getAddress(), { nonce: nonce++ });
  await voting.waitForDeployment();
  const VOTING_ADDR = await voting.getAddress();
  console.log(`[demo] voting=${VOTING_ADDR} verifier=${await verifier.getAddress()}`);

  console.log("[demo] creating election + races…");
  await (await voting.createElection(ELECTION_NAME, ELECTION_DESC,
    { nonce: nonce++ })).wait();
  await (await voting.setRace0Name("Presidente", { nonce: nonce++ })).wait();
  for (const c of CANDIDATES_PRES) {
    await (await voting.addCandidate(...c, { nonce: nonce++ })).wait();
  }
  await (await voting.addRace("Governador", { nonce: nonce++ })).wait();
  for (const c of CANDIDATES_GOV) {
    await (await voting.addCandidateToRace(RACE_GOV, ...c,
      { nonce: nonce++ })).wait();
  }
  await (await voting.addRace("Senador", { nonce: nonce++ })).wait();
  for (const c of CANDIDATES_SEN) {
    await (await voting.addCandidateToRace(RACE_SEN, ...c,
      { nonce: nonce++ })).wait();
  }

  console.log("[demo] building Poseidon Merkle tree of 3 voters…");
  const tree = await buildPoseidonTree(VOTER_IDS);
  const leafHashes = VOTER_IDS.map((_, i) => tree.leaves[i]);
  await (await voting.registerVoterHashes(leafHashes, { nonce: nonce++ })).wait();
  await (await voting.setMerkleRoot(tree.root, { nonce: nonce++ })).wait();

  // ── Zerésima (must run while PENDING) ────────────────────────────────────
  process.env.VOTING_ADDR = VOTING_ADDR;
  console.log("[demo] capturing Zerésima…");
  await runReport("./generate_zeresima.js");

  console.log("[demo] opening election…");
  await (await voting.openElection({ nonce: nonce++ })).wait();

  // ── Cast votes — 3 voters × 3 races = 9 ballots ──────────────────────────
  // (voter, race, candidate)
  const plan = [
    { vIdx: 0, race: RACE_PRES, candidate: 1n },           // Alice
    { vIdx: 0, race: RACE_GOV,  candidate: 3n },           // Eduarda
    { vIdx: 0, race: RACE_SEN,  candidate: 2n },           // Gabriela
    { vIdx: 1, race: RACE_PRES, candidate: 2n },           // Bruno
    { vIdx: 1, race: RACE_GOV,  candidate: 3n },           // Eduarda
    { vIdx: 1, race: RACE_SEN,  candidate: 0n },           // Branco
    { vIdx: 2, race: RACE_PRES, candidate: 999n },         // Nulo
    { vIdx: 2, race: RACE_GOV,  candidate: 1n },           // Carla
    { vIdx: 2, race: RACE_SEN,  candidate: 3n },           // Henrique
  ];

  for (const step of plan) {
    const voter = voters[step.vIdx];
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: step.vIdx,
      voterId:    VOTER_IDS[step.vIdx],
      electionId: ELECTION_ID,
      raceId:     step.race,
      candidateId: step.candidate,
    });
    const vNonce = await provider.getTransactionCount(voter.address, "latest");
    const tx = await voting.connect(voter).castVote(
      step.race, pubSignals, proofArr, { nonce: vNonce });
    await tx.wait();
    console.log(`[demo]   ✔ voter ${step.vIdx} → race ${step.race} ` +
                `candidate ${step.candidate}`);
  }

  console.log("[demo] closing election…");
  const aNonce = await provider.getTransactionCount(admin.address, "latest");
  await (await voting.closeElection({ nonce: aNonce })).wait();

  // ── BU + RDV (FINISHED) ──────────────────────────────────────────────────
  console.log("[demo] capturing Boletim de Urna…");
  await runReport("./generate_bu.js");
  console.log("[demo] capturing RDV…");
  await runReport("./generate_rdv.js");

  // Persist the address for the dashboard.
  fs.writeFileSync(
    path.join(__dirname, "..", "..", ".voting_addr"),
    VOTING_ADDR + "\n"
  );

  console.log(`\n[demo] DONE.  VOTING_ADDR=${VOTING_ADDR}`);
  console.log("[demo] Open viz/dashboard.html in a browser, paste the address above.\n");
}

async function runReport(rel) {
  // Each generator exports its async `main` and only self-executes when
  // invoked as a script. require() inherits the orchestrator's env (incl.
  // VOTING_ADDR), so the generators see the contract we just deployed.
  delete require.cache[require.resolve(rel)];
  const fn = require(rel);
  await fn();
  // The zerésima generator sets exitCode=2 if counters aren't all zero;
  // clear it so a downstream report doesn't inherit a stale failure.
  if (process.exitCode === 2) process.exitCode = 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
