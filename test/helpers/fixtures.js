/**
 * Shared fixtures and helpers for the VotingContract test suite.
 *
 * Uses `loadFixture` from @nomicfoundation/hardhat-network-helpers to snapshot
 * and restore the chain between tests — much faster than re-deploying.
 */
const { ethers } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");

// ─── Constants (mirror VotingContract.sol) ─────────────────────────────────

const POC_RACE_ID = 0n;
const ELECTION_ID = 1n;
const BLANK_VOTE = 0n;
const NULL_VOTE = 999n;

// Deterministic non-zero values; 15 voters fits the depth-4 Merkle tree.
const VOTER_HASHES = Array.from({ length: 15 }, (_, i) =>
  BigInt("0xAAAA0000") + BigInt(i + 1)
);
const MERKLE_ROOT = 0xDEADBEEFCAFEBABEn;

const CANDIDATE_A = ["Alice Oliveira", "PT", 13n];
const CANDIDATE_B = ["Bruno Silva", "PSD", 45n];

const EMPTY_PROOF = "0x";

// ─── Fixture factories ─────────────────────────────────────────────────────

/** Deploy MockVerifier + VotingContract (no election created yet). */
async function deployFixture() {
  const [admin, voter1, voter2, stranger] = await ethers.getSigners();

  const MockVerifier = await ethers.getContractFactory("MockVerifier");
  const mockVerifier = await MockVerifier.deploy();
  await mockVerifier.waitForDeployment();

  const VotingContract = await ethers.getContractFactory("VotingContract");
  const voting = await VotingContract.deploy(await mockVerifier.getAddress());
  await voting.waitForDeployment();

  return { voting, mockVerifier, admin, voter1, voter2, stranger };
}

/** Deploy + create election + add 2 candidates. Still PENDING. */
async function electionCreatedFixture() {
  const ctx = await deployFixture();
  await ctx.voting.createElection("Eleicao Teste PoC", "Prova de Conceito - IMT");
  await ctx.voting.addCandidate(...CANDIDATE_A);
  await ctx.voting.addCandidate(...CANDIDATE_B);
  return ctx;
}

/** Deploy + full setup + open election. State = OPEN. */
async function electionOpenFixture() {
  const ctx = await electionCreatedFixture();
  await ctx.voting.registerVoterHashes(VOTER_HASHES);
  await ctx.voting.setMerkleRoot(MERKLE_ROOT);
  await ctx.voting.openElection();
  return { ...ctx, merkleRoot: MERKLE_ROOT, electionId: ELECTION_ID };
}

/**
 * Deploy a VotingContract wired to the always-rejecting verifier.
 * Used to exercise the InvalidProof revert in castVote.
 */
async function rejectingVerifierFixture() {
  const [admin, voter1] = await ethers.getSigners();

  const Rejecting = await ethers.getContractFactory("RejectingMockVerifier");
  const rejecting = await Rejecting.deploy();
  await rejecting.waitForDeployment();

  const VotingContract = await ethers.getContractFactory("VotingContract");
  const voting = await VotingContract.deploy(await rejecting.getAddress());
  await voting.waitForDeployment();

  // Bring it to OPEN so castVote actually reaches verifyProof
  await voting.createElection("E", "D");
  await voting.addCandidate(...CANDIDATE_A);
  await voting.addCandidate(...CANDIDATE_B);
  await voting.registerVoterHashes(VOTER_HASHES);
  await voting.setMerkleRoot(MERKLE_ROOT);
  await voting.openElection();

  return { voting, admin, voter1, merkleRoot: MERKLE_ROOT, electionId: ELECTION_ID };
}

// ─── Domain helpers ────────────────────────────────────────────────────────

/**
 * Deterministic, unique nullifier per voter index.
 * In production this is Poseidon(voter_id, election_id, race_id);
 * with MockVerifier any unique uint256 satisfies on-chain checks.
 */
function makeNullifier(voterIndex, electionId = ELECTION_ID, raceId = POC_RACE_ID) {
  return (
    BigInt(voterIndex + 1) * 10n ** 18n +
    BigInt(electionId) * 10n ** 9n +
    BigInt(raceId) +
    1n // ensure non-zero even when raceId=0 and electionId=0
  );
}

/**
 * Build the canonical 5-element pubSignals tuple for castVote().
 * Layout mirrors IVerifier.sol / voter_proof.circom:
 *   [0] merkle_root
 *   [1] nullifier_hash
 *   [2] candidate_id
 *   [3] election_id
 *   [4] race_id
 */
function makePubSignals({
  nullifier,
  candidateId,
  merkleRoot = MERKLE_ROOT,
  electionId = ELECTION_ID,
  raceId = POC_RACE_ID,
}) {
  return [
    BigInt(merkleRoot),
    BigInt(nullifier),
    BigInt(candidateId),
    BigInt(electionId),
    BigInt(raceId),
  ];
}

module.exports = {
  // constants
  POC_RACE_ID,
  ELECTION_ID,
  BLANK_VOTE,
  NULL_VOTE,
  VOTER_HASHES,
  MERKLE_ROOT,
  CANDIDATE_A,
  CANDIDATE_B,
  EMPTY_PROOF,
  // fixtures (each wrapped in loadFixture by the test file)
  deployFixture,
  electionCreatedFixture,
  electionOpenFixture,
  rejectingVerifierFixture,
  // helpers
  makeNullifier,
  makePubSignals,
  loadFixture,
};
