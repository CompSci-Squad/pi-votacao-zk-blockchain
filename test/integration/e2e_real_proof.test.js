/**
 * test/integration/e2e_real_proof.test.js
 *
 * INTEGRATION SUITE — real PLONK proof, real PlonkVerifier, real on-chain castVote.
 *
 * Boundary: pi-votacao-zk-circuits ⇄ pi-votacao-zk-blockchain.
 * See ../../.github/copilot-instructions.md (root) Section 2 for invariants.
 *
 * Stack: Mocha + ethers v6 + anvil. ABIs are loaded from Foundry's `out/`.
 * The whole suite is skipped if ZK artifacts are missing (run
 * `npm run sync:circuit` first).
 */
"use strict";

const { expect } = require("chai");
const { ethers } = require("ethers");

const {
  startAnvilIfNeeded,
  stopAnvil,
  loadArtifact,
  getProvider,
  getWallets,
  snapshot,
  revert,
} = require("./helpers/anvil");
const {
  artifactsAvailable,
  buildPoseidonTree,
  generateProof,
} = require("./helpers/proof");

// ─── Scenario constants ────────────────────────────────────────────────────
const ELECTION_ID = 1n;
const RACE_ID = 0n; // POC_RACE_ID — pinned by the contract
const VOTER_IDS = [12345678901n, 22222222222n, 33333333333n];
const CANDIDATES = [
  ["Alice Oliveira", "PT", 13n],
  ["Bruno Silva", "PSD", 45n],
];
const CANDIDATE_ALICE = 1n;
const CANDIDATE_BRUNO = 2n;
const BLANK = 0n;
const NULL_VOTE = 999n;

async function expectCustomError(promise, errorName) {
  try {
    await promise;
  } catch (err) {
    const msg = err?.shortMessage || err?.message || String(err);
    if (!msg.includes(errorName)) {
      throw new Error(`expected revert ${errorName}, got: ${msg}`);
    }
    return;
  }
  throw new Error(`expected revert ${errorName}, but tx succeeded`);
}

async function expectAnyRevert(promise) {
  try {
    await promise;
  } catch (_) {
    return;
  }
  throw new Error("expected revert, but tx succeeded");
}

describe("Integration: real PLONK proof → on-chain castVote", function () {
  this.timeout(120_000);

  let provider;
  let wallets;
  let votingArtifact;
  let verifierArtifact;
  let baselineSnapshot;
  let voting;
  let voter;
  let otherVoter;
  let third;
  let tree;

  before(async function () {
    if (!artifactsAvailable()) {
      // eslint-disable-next-line no-console
      console.warn(
        "\n  [SKIP] integration suite — ZK artifacts not found. Run: npm run sync:circuit\n"
      );
      this.skip();
    }
    await startAnvilIfNeeded();
    provider = getProvider();
    wallets = getWallets(provider);
    [, voter, otherVoter, third] = wallets;

    votingArtifact = loadArtifact("VotingContract.sol", "VotingContract");
    verifierArtifact = loadArtifact("Verifier.sol", "PlonkVerifier");

    await deployAndOpen();
    baselineSnapshot = await snapshot(provider);
  });

  beforeEach(async () => {
    await revert(provider, baselineSnapshot);
    baselineSnapshot = await snapshot(provider);
  });

  async function deployAndOpen() {
    const admin = wallets[0];

    const VerifierFactory = new ethers.ContractFactory(
      verifierArtifact.abi,
      verifierArtifact.bytecode,
      admin
    );
    const verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();

    const VotingFactory = new ethers.ContractFactory(
      votingArtifact.abi,
      votingArtifact.bytecode,
      admin
    );
    voting = await VotingFactory.deploy(await verifier.getAddress());
    await voting.waitForDeployment();

    await (await voting.createElection("Eleicao Integracao", "E2E real-proof suite")).wait();
    for (const c of CANDIDATES) {
      await (await voting.addCandidate(...c)).wait();
    }

    tree = await buildPoseidonTree(VOTER_IDS);
    const leafHashes = VOTER_IDS.map((_, i) => tree.leaves[i]);

    await (await voting.registerVoterHashes(leafHashes)).wait();
    await (await voting.setMerkleRoot(tree.root)).wait();
    await (await voting.openElection()).wait();
  }

  it("happy path: registered voter casts a vote, counter increments, VoteCast emitted", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    expect(pubSignals).to.have.lengthOf(5);
    expect(pubSignals[0]).to.equal(BigInt(tree.root));
    expect(pubSignals[2]).to.equal(CANDIDATE_ALICE);
    expect(pubSignals[3]).to.equal(ELECTION_ID);
    expect(pubSignals[4]).to.equal(RACE_ID);

    const tx = await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr);
    const rc = await tx.wait();

    const ev = rc.logs
      .map((l) => {
        try {
          return voting.interface.parseLog(l);
        } catch (_) {
          return null;
        }
      })
      .find((p) => p?.name === "VoteCast");
    expect(ev, "VoteCast emitted").to.not.equal(undefined);
    expect(ev.args[0]).to.equal(pubSignals[1]);
    expect(ev.args[1]).to.equal(RACE_ID);
    expect(ev.args[2]).to.equal(CANDIDATE_ALICE);

    const [resCandidates, blank, nullVotes, total] = await voting.getResults();
    expect(total).to.equal(1n);
    expect(blank).to.equal(0n);
    expect(nullVotes).to.equal(0n);
    expect(resCandidates[0].voteCount).to.equal(1n);
    expect(resCandidates[1].voteCount).to.equal(0n);

    expect(await voting.isNullifierUsed(RACE_ID, pubSignals[1])).to.equal(true);
  });

  it("double vote: same nullifier rejected the second time", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 1,
      voterId: VOTER_IDS[1],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_BRUNO,
    });

    await (await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr)).wait();
    await expectCustomError(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
      "NullifierAlreadyUsed"
    );
  });

  it("relay attack: tampering pubSignals[4] (race_id) trips RaceIdMismatch", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    const tampered = [...pubSignals];
    tampered[4] = 1n;

    await expectCustomError(
      voting.connect(voter).castVote(RACE_ID, tampered, proofArr),
      "RaceIdMismatch"
    );
  });

  it("wrong merkle root: voter from a stale tree is rejected", async () => {
    const staleTree = await buildPoseidonTree([99999999999n]);
    const { proofArr, pubSignals } = await generateProof({
      tree: staleTree,
      voterIndex: 0,
      voterId: 99999999999n,
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    await expectCustomError(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
      "InvalidMerkleRoot"
    );
  });

  it("wrong election id: pubSignals[3] mismatch is rejected", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: 999n,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    await expectCustomError(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
      "InvalidElectionId"
    );
  });

  it("invalid proof bytes: tampering proof[0] makes the verifier reject", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    const broken = [...proofArr];
    broken[0] = (broken[0] + 1n) % (1n << 254n);

    await expectAnyRevert(
      voting.connect(voter).castVote(RACE_ID, pubSignals, broken)
    );
  });

  it("election state guard: castVote in FINISHED state is rejected", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    await (await voting.closeElection()).wait();
    await expectCustomError(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
      "ElectionNotOpen"
    );
  });

  it("blank vote: candidate_id = 0 increments race.blankVotes", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 2,
      voterId: VOTER_IDS[2],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: BLANK,
    });

    await (await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr)).wait();
    const [, blank, nullVotes, total] = await voting.getResults();
    expect(blank).to.equal(1n);
    expect(nullVotes).to.equal(0n);
    expect(total).to.equal(1n);
  });

  it("null vote: candidate_id = 999 increments race.nullVotes", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 2,
      voterId: VOTER_IDS[2],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: NULL_VOTE,
    });

    await (await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr)).wait();
    const [, blank, nullVotes, total] = await voting.getResults();
    expect(blank).to.equal(0n);
    expect(nullVotes).to.equal(1n);
    expect(total).to.equal(1n);
  });

  it("results audit: 3 voters → counts match off-chain expectation", async () => {
    const signers = [voter, otherVoter, third];
    const choices = [CANDIDATE_ALICE, CANDIDATE_BRUNO, CANDIDATE_ALICE];

    for (let i = 0; i < VOTER_IDS.length; i++) {
      const { proofArr, pubSignals } = await generateProof({
        tree,
        voterIndex: i,
        voterId: VOTER_IDS[i],
        electionId: ELECTION_ID,
        raceId: RACE_ID,
        candidateId: choices[i],
      });
      await (await voting.connect(signers[i]).castVote(RACE_ID, pubSignals, proofArr)).wait();
    }

    const [resCandidates, blank, nullVotes, total] = await voting.getResults();
    expect(total).to.equal(3n);
    expect(blank).to.equal(0n);
    expect(nullVotes).to.equal(0n);
    expect(resCandidates[0].voteCount).to.equal(2n);
    expect(resCandidates[1].voteCount).to.equal(1n);
  });
});
/**
 * test/integration/e2e_real_proof.test.js
 *
 * INTEGRATION SUITE — real PLONK proof, real PlonkVerifier, real on-chain castVote.
 *
 * Boundary: pi-votacao-zk-circuits ⇄ pi-votacao-zk-blockchain.
 * See ../../.github/copilot-instructions.md (root) Section 2 for invariants.
 *
 * Stack: Mocha + ethers v6 + anvil. ABIs are loaded from Foundry's `out/`.
 * Deployment is performed in JS (rather than via `forge script`) so the suite
 * can take an evm_snapshot once and revert between tests for speed.
 *
 * The whole suite is skipped if ZK artifacts are missing (run
 * `npm run sync:circuit` from this repo first).
 */
"use strict";

const { expect } = require("chai");
const { ethers } = require("ethers");

const {
  startAnvilIfNeeded,
  stopAnvil,
  loadArtifact,
  getProvider,
  getWallets,
  snapshot,
  revert,
} = require("./helpers/anvil");
const {
  artifactsAvailable,
  buildPoseidonTree,
  generateProof,
} = require("./helpers/proof");

// ─── Scenario constants ────────────────────────────────────────────────────
const ELECTION_ID = 1n;
const RACE_ID = 0n; // POC_RACE_ID — pinned by the contract
const VOTER_IDS = [12345678901n, 22222222222n, 33333333333n];
const CANDIDATES = [
  ["Alice Oliveira", "PT", 13n],
  ["Bruno Silva", "PSD", 45n],
];
const CANDIDATE_ALICE = 1n;
const CANDIDATE_BRUNO = 2n;
const BLANK = 0n;
const NULL_VOTE = 999n;

// ─── Helpers ───────────────────────────────────────────────────────────────

async function expectCustomError(promise, errorName) {
  try {
    await promise;
  } catch (err) {
    const msg = err?.shortMessage || err?.message || String(err);
    if (!msg.includes(errorName)) {
      throw new Error(`expected revert ${errorName}, got: ${msg}`);
    }
    return;
  }
  throw new Error(`expected revert ${errorName}, but tx succeeded`);
}

async function expectAnyRevert(promise) {
  try {
    await promise;
  } catch (_) {
    return;
  }
  throw new Error("expected revert, but tx succeeded");
}

// ─── Suite ─────────────────────────────────────────────────────────────────

describe("Integration: real PLONK proof → on-chain castVote", function () {
  this.timeout(120_000);

  let provider;
  let wallets;
  let votingArtifact;
  let verifierArtifact;
  let baselineSnapshot; // snapshot taken right after admin setup
  let voting;
  let voter;
  let otherVoter;
  let third;
  let tree;

  before(async function () {
    if (!artifactsAvailable()) {
      // eslint-disable-next-line no-console
      console.warn(
        "\n  [SKIP] integration suite — ZK artifacts not found.\n" +
          "         Run: npm run sync:circuit\n"
      );
      this.skip();
    }
    await startAnvilIfNeeded();
    provider = getProvider();
    wallets = getWallets(provider);
    [, voter, otherVoter, third] = wallets;

    votingArtifact = loadArtifact("VotingContract.sol", "VotingContract");
    verifierArtifact = loadArtifact("Verifier.sol", "PlonkVerifier");

    await deployAndOpen();
    baselineSnapshot = await snapshot(provider);
  });

  beforeEach(async () => {
    // Restore to the post-setup baseline so each test starts fresh.
    await revert(provider, baselineSnapshot);
    baselineSnapshot = await snapshot(provider);
  });

  after(async () => {
    await stopAnvil();
  });

  async function deployAndOpen() {
    const admin = wallets[0];

    const VerifierFactory = new ethers.ContractFactory(
      verifierArtifact.abi,
      verifierArtifact.bytecode,
      admin
    );
    const verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();

    const VotingFactory = new ethers.ContractFactory(
      votingArtifact.abi,
      votingArtifact.bytecode,
      admin
    );
    voting = await VotingFactory.deploy(await verifier.getAddress());
    await voting.waitForDeployment();

    await (await voting.createElection("Eleicao Integracao", "E2E real-proof suite")).wait();
    for (const c of CANDIDATES) {
      await (await voting.addCandidate(...c)).wait();
    }

    tree = await buildPoseidonTree(VOTER_IDS);
    const leafHashes = VOTER_IDS.map((_, i) => tree.leaves[i]);

    await (await voting.registerVoterHashes(leafHashes)).wait();
    await (await voting.setMerkleRoot(tree.root)).wait();
    await (await voting.openElection()).wait();
  }

  // ── Happy path ──────────────────────────────────────────────────────────
  it("happy path: registered voter casts a vote, counter increments, VoteCast emitted", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    expect(pubSignals).to.have.lengthOf(5);
    expect(pubSignals[0]).to.equal(BigInt(tree.root));
    expect(pubSignals[2]).to.equal(CANDIDATE_ALICE);
    expect(pubSignals[3]).to.equal(ELECTION_ID);
    expect(pubSignals[4]).to.equal(RACE_ID);

    const tx = await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr);
    const rc = await tx.wait();

    const ev = rc.logs
      .map((l) => {
        try {
          return voting.interface.parseLog(l);
        } catch (_) {
          return null;
        }
      })
      .find((p) => p?.name === "VoteCast");
    expect(ev, "VoteCast emitted").to.not.equal(undefined);
    expect(ev.args[0]).to.equal(pubSignals[1]);
    expect(ev.args[1]).to.equal(RACE_ID);
    expect(ev.args[2]).to.equal(CANDIDATE_ALICE);

    const [resCandidates, blank, nullVotes, total] = await voting.getResults();
    expect(total).to.equal(1n);
    expect(blank).to.equal(0n);
    expect(nullVotes).to.equal(0n);
    expect(resCandidates[0].voteCount).to.equal(1n);
    expect(resCandidates[1].voteCount).to.equal(0n);

    expect(await voting.isNullifierUsed(RACE_ID, pubSignals[1])).to.equal(true);
  });

  // ── Double vote ─────────────────────────────────────────────────────────
  it("double vote: same nullifier rejected the second time", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 1,
      voterId: VOTER_IDS[1],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_BRUNO,
    });

    await (await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr)).wait();
    await expectCustomError(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
      "NullifierAlreadyUsed"
    );
  });

  // ── Relay attack (race_id tamper) ───────────────────────────────────────
  it("relay attack: tampering pubSignals[4] (race_id) trips RaceIdMismatch", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    const tampered = [...pubSignals];
    tampered[4] = 1n;

    await expectCustomError(
      voting.connect(voter).castVote(RACE_ID, tampered, proofArr),
      "RaceIdMismatch"
    );
  });

  // ── Wrong Merkle root ───────────────────────────────────────────────────
  it("wrong merkle root: voter from a stale tree is rejected", async () => {
    const staleTree = await buildPoseidonTree([99999999999n]);
    const { proofArr, pubSignals } = await generateProof({
      tree: staleTree,
      voterIndex: 0,
      voterId: 99999999999n,
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    await expectCustomError(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
      "InvalidMerkleRoot"
    );
  });

  // ── Wrong election id ───────────────────────────────────────────────────
  it("wrong election id: pubSignals[3] mismatch is rejected", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: 999n,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    await expectCustomError(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
      "InvalidElectionId"
    );
  });

  // ── Invalid proof bytes ─────────────────────────────────────────────────
  it("invalid proof bytes: tampering proof[0] makes the verifier reject", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    const broken = [...proofArr];
    broken[0] = (broken[0] + 1n) % (1n << 254n);

    // PlonkVerifier may revert via assembly or return false → InvalidProof.
    await expectAnyRevert(
      voting.connect(voter).castVote(RACE_ID, pubSignals, broken)
    );
  });

  // ── Election state guard (FINISHED) ─────────────────────────────────────
  it("election state guard: castVote in FINISHED state is rejected", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    await (await voting.closeElection()).wait();
    await expectCustomError(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
      "ElectionNotOpen"
    );
  });

  // ── Blank vote ──────────────────────────────────────────────────────────
  it("blank vote: candidate_id = 0 increments race.blankVotes", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 2,
      voterId: VOTER_IDS[2],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: BLANK,
    });

    await (await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr)).wait();
    const [, blank, nullVotes, total] = await voting.getResults();
    expect(blank).to.equal(1n);
    expect(nullVotes).to.equal(0n);
    expect(total).to.equal(1n);
  });

  // ── Null/spoiled vote ───────────────────────────────────────────────────
  it("null vote: candidate_id = 999 increments race.nullVotes", async () => {
    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 2,
      voterId: VOTER_IDS[2],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: NULL_VOTE,
    });

    await (await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr)).wait();
    const [, blank, nullVotes, total] = await voting.getResults();
    expect(blank).to.equal(0n);
    expect(nullVotes).to.equal(1n);
    expect(total).to.equal(1n);
  });

  // ── Multi-vote tally audit ──────────────────────────────────────────────
  it("results audit: 3 voters → counts match off-chain expectation", async () => {
    const signers = [voter, otherVoter, third];
    const choices = [CANDIDATE_ALICE, CANDIDATE_BRUNO, CANDIDATE_ALICE];

    for (let i = 0; i < VOTER_IDS.length; i++) {
      const { proofArr, pubSignals } = await generateProof({
        tree,
        voterIndex: i,
        voterId: VOTER_IDS[i],
        electionId: ELECTION_ID,
        raceId: RACE_ID,
        candidateId: choices[i],
      });
      await (await voting.connect(signers[i]).castVote(RACE_ID, pubSignals, proofArr)).wait();
    }

    const [resCandidates, blank, nullVotes, total] = await voting.getResults();
    expect(total).to.equal(3n);
    expect(blank).to.equal(0n);
    expect(nullVotes).to.equal(0n);
    expect(resCandidates[0].voteCount).to.equal(2n); // Alice
    expect(resCandidates[1].voteCount).to.equal(1n); // Bruno
  });
});
/**
 * test/integration/e2e_real_proof.test.js
 *
 * INTEGRATION SUITE — real PLONK proof, real PlonkVerifier, real on-chain castVote.
 *
 * Boundary: pi-votacao-zk-circuits ⇄ pi-votacao-zk-blockchain.
 * See ../../.github/copilot-instructions.md (root) Section 2 for invariants
 * and Section 4 for the full required scenario list.
 *
 * The whole suite is skipped if ZK artifacts are missing (run `npm run sync:circuit`
 * from this repo first).
 *
 * Boundary constraint enforced by VotingContract for this PoC:
 *   POC_RACE_ID = 0  →  multi-race scenarios are intentionally NOT covered here.
 *   See SESSION_LOG (blockchain repo) "Multi-race real" deferred item.
 */
"use strict";

const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");

const {
  artifactsAvailable,
  buildPoseidonTree,
  generateProof,
} = require("./helpers/proof");

// ─── Scenario constants ────────────────────────────────────────────────────
const ELECTION_ID = 1n;
const RACE_ID = 0n; // POC_RACE_ID — pinned by the contract
const VOTER_IDS = [12345678901n, 22222222222n, 33333333333n];
const CANDIDATES = [
  ["Alice Oliveira", "PT", 13n],
  ["Bruno Silva", "PSD", 45n],
];
const CANDIDATE_ALICE = 1n;
const CANDIDATE_BRUNO = 2n;
const BLANK = 0n;
const NULL_VOTE = 999n;

// ─── Shared fixture: deploy real PlonkVerifier + VotingContract, OPEN state ─
async function realProofOpenFixture() {
  const [admin, voter, otherVoter] = await ethers.getSigners();

  const Plonk = await ethers.getContractFactory("PlonkVerifier");
  const verifier = await Plonk.deploy();
  await verifier.waitForDeployment();

  const Voting = await ethers.getContractFactory("VotingContract");
  const voting = await Voting.deploy(await verifier.getAddress());
  await voting.waitForDeployment();

  await voting.createElection("Eleicao Integracao", "E2E real-proof suite");
  for (const c of CANDIDATES) await voting.addCandidate(...c);

  const tree = await buildPoseidonTree(VOTER_IDS);
  const leafHashes = VOTER_IDS.map((_, i) => tree.leaves[i]);

  await voting.registerVoterHashes(leafHashes);
  await voting.setMerkleRoot(tree.root);
  await voting.openElection();

  return { admin, voter, otherVoter, verifier, voting, tree };
}

// ─── Suite ─────────────────────────────────────────────────────────────────
describe("Integration: real PLONK proof → on-chain castVote", function () {
  // PLONK proof generation is heavy; bump per-test timeout.
  this.timeout(120_000);

  before(function () {
    if (!artifactsAvailable()) {
      // eslint-disable-next-line no-console
      console.warn(
        "\n  [SKIP] integration suite — ZK artifacts not found.\n" +
          "         Run: npm run sync:circuit\n",
      );
      this.skip();
    }
  });

  // ── Happy path ──────────────────────────────────────────────────────────
  it("happy path: registered voter casts a vote, counter increments, VoteCast emitted", async () => {
    const { voting, voter, tree } = await loadFixture(realProofOpenFixture);

    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    // Sanity: pubSignals carry the canonical 5 in the canonical order.
    expect(pubSignals).to.have.lengthOf(5);
    expect(pubSignals[0]).to.equal(BigInt(tree.root));
    expect(pubSignals[2]).to.equal(CANDIDATE_ALICE);
    expect(pubSignals[3]).to.equal(ELECTION_ID);
    expect(pubSignals[4]).to.equal(RACE_ID);

    await expect(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
    )
      .to.emit(voting, "VoteCast")
      .withArgs(pubSignals[1], RACE_ID, CANDIDATE_ALICE);

    const [resCandidates, blank, nullVotes, total] = await voting.getResults();
    expect(total).to.equal(1n);
    expect(blank).to.equal(0n);
    expect(nullVotes).to.equal(0n);
    expect(resCandidates[0].voteCount).to.equal(1n);
    expect(resCandidates[1].voteCount).to.equal(0n);

    expect(await voting.isNullifierUsed(RACE_ID, pubSignals[1])).to.equal(true);
  });

  // ── Double vote ─────────────────────────────────────────────────────────
  it("double vote: same nullifier rejected the second time", async () => {
    const { voting, voter, tree } = await loadFixture(realProofOpenFixture);

    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 1,
      voterId: VOTER_IDS[1],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_BRUNO,
    });

    await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr);
    await expect(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
    ).to.be.revertedWithCustomError(voting, "NullifierAlreadyUsed");
  });

  // ── Relay attack ────────────────────────────────────────────────────────
  it("relay attack: tampering pubSignals[4] (race_id) breaks proof verification", async () => {
    const { voting, voter, tree } = await loadFixture(realProofOpenFixture);

    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    // Flip race_id to 1 in pubSignals while keeping the proof bytes intact.
    const tampered = [...pubSignals];
    tampered[4] = 1n;

    // First the contract guards raceId==pubSignals[4]. We pass raceId=1 so
    // the request reaches the verifier; verification then fails because the
    // proof was bound to race_id=0.
    // But raceId=1 also fails the POC_RACE_ID guard, so we'd revert earlier.
    // Pass raceId=0 instead → the contract's RaceIdMismatch fires first.
    await expect(
      voting.connect(voter).castVote(RACE_ID, tampered, proofArr),
    ).to.be.revertedWithCustomError(voting, "RaceIdMismatch");
  });

  // ── Wrong Merkle root ───────────────────────────────────────────────────
  it("wrong merkle root: voter from a stale tree is rejected", async () => {
    const { voting, voter } = await loadFixture(realProofOpenFixture);

    // Build a *different* tree (voter not in the on-chain set) and try to vote.
    const staleTree = await buildPoseidonTree([99999999999n]);
    const { proofArr, pubSignals } = await generateProof({
      tree: staleTree,
      voterIndex: 0,
      voterId: 99999999999n,
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    await expect(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
    ).to.be.revertedWithCustomError(voting, "InvalidMerkleRoot");
  });

  // ── Wrong election id ───────────────────────────────────────────────────
  it("wrong election id: pubSignals[3] mismatch is rejected", async () => {
    const { voting, voter, tree } = await loadFixture(realProofOpenFixture);

    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: 999n, // wrong election
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    await expect(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
    ).to.be.revertedWithCustomError(voting, "InvalidElectionId");
  });

  // ── Invalid proof bytes ─────────────────────────────────────────────────
  it("invalid proof bytes: tampering proof[0] makes the verifier reject", async () => {
    const { voting, voter, tree } = await loadFixture(realProofOpenFixture);

    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    const broken = [...proofArr];
    broken[0] = (broken[0] + 1n) % (1n << 254n); // perturb a single field element

    await expect(
      voting.connect(voter).castVote(RACE_ID, pubSignals, broken),
    ).to.be.reverted; // PlonkVerifier may revert (asm) or return false → InvalidProof
  });

  // ── Election state guard (PENDING / FINISHED) ───────────────────────────
  it("election state guard: castVote in FINISHED state is rejected", async () => {
    const { voting, voter, tree } = await loadFixture(realProofOpenFixture);

    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 0,
      voterId: VOTER_IDS[0],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: CANDIDATE_ALICE,
    });

    await voting.closeElection();

    await expect(
      voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr),
    ).to.be.revertedWithCustomError(voting, "ElectionNotOpen");
  });

  // ── Blank vote ──────────────────────────────────────────────────────────
  it("blank vote: candidate_id = 0 increments race.blankVotes", async () => {
    const { voting, voter, tree } = await loadFixture(realProofOpenFixture);

    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 2,
      voterId: VOTER_IDS[2],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: BLANK,
    });

    await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr);

    const [, blank, nullVotes, total] = await voting.getResults();
    expect(blank).to.equal(1n);
    expect(nullVotes).to.equal(0n);
    expect(total).to.equal(1n);
  });

  // ── Null/spoiled vote ───────────────────────────────────────────────────
  it("null vote: candidate_id = 999 increments race.nullVotes", async () => {
    const { voting, voter, tree } = await loadFixture(realProofOpenFixture);

    const { proofArr, pubSignals } = await generateProof({
      tree,
      voterIndex: 2,
      voterId: VOTER_IDS[2],
      electionId: ELECTION_ID,
      raceId: RACE_ID,
      candidateId: NULL_VOTE,
    });

    await voting.connect(voter).castVote(RACE_ID, pubSignals, proofArr);

    const [, blank, nullVotes, total] = await voting.getResults();
    expect(blank).to.equal(0n);
    expect(nullVotes).to.equal(1n);
    expect(total).to.equal(1n);
  });

  // ── Multi-vote tally audit ──────────────────────────────────────────────
  it("results audit: 3 voters → counts match off-chain expectation", async () => {
    const { voting, voter, otherVoter, tree } = await loadFixture(realProofOpenFixture);
    const [, , , third] = await ethers.getSigners();

    const wallets = [voter, otherVoter, third];
    const choices = [CANDIDATE_ALICE, CANDIDATE_BRUNO, CANDIDATE_ALICE];

    for (let i = 0; i < VOTER_IDS.length; i++) {
      const { proofArr, pubSignals } = await generateProof({
        tree,
        voterIndex: i,
        voterId: VOTER_IDS[i],
        electionId: ELECTION_ID,
        raceId: RACE_ID,
        candidateId: choices[i],
      });
      await voting.connect(wallets[i]).castVote(RACE_ID, pubSignals, proofArr);
    }

    const [resCandidates, blank, nullVotes, total] = await voting.getResults();
    expect(total).to.equal(3n);
    expect(blank).to.equal(0n);
    expect(nullVotes).to.equal(0n);
    expect(resCandidates[0].voteCount).to.equal(2n); // Alice
    expect(resCandidates[1].voteCount).to.equal(1n); // Bruno
  });
});
