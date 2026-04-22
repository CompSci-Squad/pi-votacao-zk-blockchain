const { expect } = require("chai");
const {
  loadFixture,
  deployFixture,
  electionCreatedFixture,
  electionOpenFixture,
  VOTER_HASHES,
  MERKLE_ROOT,
} = require("./helpers/fixtures");

describe("VotingContract — election lifecycle / state machine", function () {
  // ── openElection ────────────────────────────────────────────────────────

  describe("openElection", function () {
    it("transitions PENDING → OPEN", async function () {
      const { voting } = await loadFixture(electionCreatedFixture);
      await voting.registerVoterHashes(VOTER_HASHES);
      await voting.setMerkleRoot(MERKLE_ROOT);
      await voting.openElection();
      expect(await voting.state()).to.equal(1n);
    });

    it("emits ElectionOpened", async function () {
      const { voting } = await loadFixture(electionCreatedFixture);
      await voting.registerVoterHashes(VOTER_HASHES);
      await voting.setMerkleRoot(MERKLE_ROOT);
      await expect(voting.openElection()).to.emit(voting, "ElectionOpened");
    });

    it("reverts when called by non-admin", async function () {
      const { voting, stranger } = await loadFixture(electionCreatedFixture);
      await expect(
        voting.connect(stranger).openElection()
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });

    it("reverts when already OPEN (cannot reopen)", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      await expect(voting.openElection()).to.be.revertedWithCustomError(
        voting,
        "ElectionNotPending"
      );
    });
  });

  // ── closeElection ───────────────────────────────────────────────────────

  describe("closeElection", function () {
    it("transitions OPEN → FINISHED", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      await voting.closeElection();
      expect(await voting.state()).to.equal(2n);
    });

    it("emits ElectionClosed", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      await expect(voting.closeElection()).to.emit(voting, "ElectionClosed");
    });

    it("reverts when called by non-admin", async function () {
      const { voting, stranger } = await loadFixture(electionOpenFixture);
      await expect(
        voting.connect(stranger).closeElection()
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });

    it("reverts when not OPEN (PENDING)", async function () {
      const { voting } = await loadFixture(deployFixture);
      await expect(voting.closeElection()).to.be.revertedWithCustomError(
        voting,
        "ElectionNotOpen"
      );
    });

    it("cannot reopen after FINISHED (state machine is forward-only)", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      await voting.closeElection();
      await expect(voting.openElection()).to.be.revertedWithCustomError(
        voting,
        "ElectionNotPending"
      );
    });
  });
});
