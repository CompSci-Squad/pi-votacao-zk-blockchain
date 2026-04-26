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
  ensureAnvilReachable,
  resetAnvil,
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

function extractRevertData(err) {
  const candidates = [
    err?.data,
    err?.info?.error?.data,
    err?.error?.data,
    err?.error?.error?.data,
    err?.info?.error?.data?.data,
    err?.transaction?.data,
    err?.revert?.data,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("0x") && c.length >= 10) return c;
    if (c && typeof c === "object" && typeof c.data === "string" && c.data.startsWith("0x")) {
      return c.data;
    }
  }
  return null;
}

function decodeRevertErrorName(iface, err) {
  const data = extractRevertData(err);
  if (!data) return null;
  try {
    const parsed = iface.parseError(data);
    return parsed?.name ?? null;
  } catch (_) {
    return null;
  }
}

async function expectCustomError(promise, errorName, iface) {
  try {
    await promise;
  } catch (err) {
    const decoded = iface ? decodeRevertErrorName(iface, err) : null;
    const msg = err?.shortMessage || err?.message || String(err);
    if (decoded === errorName) return;
    if (!decoded && msg.includes(errorName)) return;
    throw new Error(
      `expected revert ${errorName}, got: ${decoded || "(undecoded)"} -- ${msg}`
    );
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
    await ensureAnvilReachable();
    await resetAnvil(getProvider());
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

  after(async () => {
    // container lifecycle is managed by docker compose
  });

  async function deployAndOpen() {
    const admin = wallets[0];
    let nonce = await provider.getTransactionCount(admin.address, "latest");

    const VerifierFactory = new ethers.ContractFactory(
      verifierArtifact.abi,
      verifierArtifact.bytecode,
      admin
    );
    const verifier = await VerifierFactory.deploy({ nonce: nonce++ });
    await verifier.waitForDeployment();

    const VotingFactory = new ethers.ContractFactory(
      votingArtifact.abi,
      votingArtifact.bytecode,
      admin
    );
    voting = await VotingFactory.deploy(await verifier.getAddress(), { nonce: nonce++ });
    await voting.waitForDeployment();

    await (await voting.createElection("Eleicao Integracao", "E2E real-proof suite", { nonce: nonce++ })).wait();
    for (const c of CANDIDATES) {
      await (await voting.addCandidate(...c, { nonce: nonce++ })).wait();
    }

    tree = await buildPoseidonTree(VOTER_IDS);
    const leafHashes = VOTER_IDS.map((_, i) => tree.leaves[i]);

    await (await voting.registerVoterHashes(leafHashes, { nonce: nonce++ })).wait();
    await (await voting.setMerkleRoot(tree.root, { nonce: nonce++ })).wait();
    await (await voting.openElection({ nonce: nonce++ })).wait();
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
      voting.connect(otherVoter).castVote(RACE_ID, pubSignals, proofArr),
      "NullifierAlreadyUsed", voting.interface
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
      "RaceIdMismatch", voting.interface
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
      "InvalidMerkleRoot", voting.interface
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
      "InvalidElectionId", voting.interface
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
      "ElectionNotOpen", voting.interface
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
