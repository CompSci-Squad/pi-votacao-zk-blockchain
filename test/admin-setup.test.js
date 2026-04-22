const { expect } = require("chai");
const {
  loadFixture,
  deployFixture,
  electionCreatedFixture,
  CANDIDATE_A,
  CANDIDATE_B,
  VOTER_HASHES,
  MERKLE_ROOT,
} = require("./helpers/fixtures");

describe("VotingContract — admin setup (PENDING state)", function () {
  // ── createElection ──────────────────────────────────────────────────────

  describe("createElection", function () {
    it("creates an election, sets electionId=1, emits ElectionCreated", async function () {
      const { voting } = await loadFixture(deployFixture);
      await expect(voting.createElection("E1", "Desc"))
        .to.emit(voting, "ElectionCreated")
        .withArgs("E1", 1n);
      expect(await voting.electionName()).to.equal("E1");
      expect(await voting.currentElectionId()).to.equal(1n);
    });

    it("reverts when called by non-admin", async function () {
      const { voting, stranger } = await loadFixture(deployFixture);
      await expect(
        voting.connect(stranger).createElection("X", "Y")
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });

    it("reverts when called twice", async function () {
      const { voting } = await loadFixture(deployFixture);
      await voting.createElection("First", "D");
      await expect(
        voting.createElection("Second", "D")
      ).to.be.revertedWithCustomError(voting, "ElectionAlreadyExists");
    });
  });

  // ── addCandidate ────────────────────────────────────────────────────────

  describe("addCandidate", function () {
    it("adds candidates with sequential 1-based IDs", async function () {
      const { voting } = await loadFixture(electionCreatedFixture);
      const c1 = await voting.candidates(0);
      const c2 = await voting.candidates(1);
      expect(c1.id).to.equal(1n);
      expect(c1.name).to.equal(CANDIDATE_A[0]);
      expect(c2.id).to.equal(2n);
      expect(c2.name).to.equal(CANDIDATE_B[0]);
    });

    it("emits CandidateAdded", async function () {
      const { voting } = await loadFixture(deployFixture);
      await voting.createElection("E", "D");
      await expect(voting.addCandidate("Carol", "PV", 30n))
        .to.emit(voting, "CandidateAdded")
        .withArgs(1n, "Carol", 30n);
    });

    it("reverts when number is duplicated", async function () {
      const { voting } = await loadFixture(electionCreatedFixture);
      await expect(
        voting.addCandidate("Dup", "PT", CANDIDATE_A[2])
      ).to.be.revertedWithCustomError(voting, "CandidateNumberAlreadyUsed");
    });

    it("reverts when called by non-admin", async function () {
      const { voting, stranger } = await loadFixture(electionCreatedFixture);
      await expect(
        voting.connect(stranger).addCandidate("X", "P", 99n)
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });
  });

  // ── registerVoterHashes ─────────────────────────────────────────────────

  describe("registerVoterHashes", function () {
    it("stores hashes and emits VoterHashesRegistered", async function () {
      const { voting } = await loadFixture(electionCreatedFixture);
      await expect(voting.registerVoterHashes(VOTER_HASHES))
        .to.emit(voting, "VoterHashesRegistered")
        .withArgs(VOTER_HASHES);
      const stored = await voting.getVoterHashes();
      expect(stored.length).to.equal(VOTER_HASHES.length);
      expect(stored[0]).to.equal(VOTER_HASHES[0]);
    });

    it("reverts on second call (idempotency guard)", async function () {
      const { voting } = await loadFixture(electionCreatedFixture);
      await voting.registerVoterHashes(VOTER_HASHES);
      await expect(
        voting.registerVoterHashes([1n])
      ).to.be.revertedWithCustomError(voting, "VoterHashesAlreadyRegistered");
    });

    it("reverts when more than MAX_VOTERS (16)", async function () {
      const { voting } = await loadFixture(electionCreatedFixture);
      const tooMany = Array.from({ length: 17 }, (_, i) => BigInt(i + 1));
      await expect(
        voting.registerVoterHashes(tooMany)
      ).to.be.revertedWithCustomError(voting, "TooManyVoters");
    });

    it("reverts when any hash is zero", async function () {
      const { voting } = await loadFixture(electionCreatedFixture);
      await expect(
        voting.registerVoterHashes([1n, 0n, 3n])
      ).to.be.revertedWithCustomError(voting, "InvalidVoterHash");
    });

    it("reverts when called by non-admin", async function () {
      const { voting, stranger } = await loadFixture(electionCreatedFixture);
      await expect(
        voting.connect(stranger).registerVoterHashes([1n])
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });
  });

  // ── setMerkleRoot ───────────────────────────────────────────────────────

  describe("setMerkleRoot", function () {
    it("sets the root and emits MerkleRootSet", async function () {
      const { voting } = await loadFixture(electionCreatedFixture);
      await voting.registerVoterHashes(VOTER_HASHES);
      await expect(voting.setMerkleRoot(MERKLE_ROOT))
        .to.emit(voting, "MerkleRootSet")
        .withArgs(MERKLE_ROOT);
      expect(await voting.voterMerkleRoot()).to.equal(MERKLE_ROOT);
    });

    it("reverts when no voter hashes have been registered", async function () {
      const { voting } = await loadFixture(electionCreatedFixture);
      await expect(
        voting.setMerkleRoot(123n)
      ).to.be.revertedWithCustomError(voting, "NoVoterHashesRegistered");
    });

    it("reverts when called by non-admin", async function () {
      const { voting, stranger } = await loadFixture(electionCreatedFixture);
      await voting.registerVoterHashes(VOTER_HASHES);
      await expect(
        voting.connect(stranger).setMerkleRoot(1n)
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });
  });
});
