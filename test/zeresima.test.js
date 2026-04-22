const { expect } = require("chai");
const {
  loadFixture,
  electionCreatedFixture,
  electionOpenFixture,
  VOTER_HASHES,
  MERKLE_ROOT,
  POC_RACE_ID,
  EMPTY_PROOF,
  makeNullifier,
  makePubSignals,
} = require("./helpers/fixtures");

describe("VotingContract — getZeresima (pre-election audit)", function () {
  it("returns expected fields in PENDING with full setup", async function () {
    const { voting } = await loadFixture(electionCreatedFixture);
    await voting.registerVoterHashes(VOTER_HASHES);
    await voting.setMerkleRoot(MERKLE_ROOT);

    const z = await voting.getZeresima();
    expect(z._electionName).to.equal("Eleicao Teste PoC");
    expect(z._candidates.length).to.equal(2);
    expect(z.voterCount).to.equal(BigInt(VOTER_HASHES.length));
    expect(z.allZero).to.equal(true);
    expect(z._blockTimestamp).to.be.a("bigint").and.to.be.greaterThan(0n);
    expect(z._blockNumber).to.be.a("bigint").and.to.be.greaterThan(0n);
  });

  it("reverts ElectionNotPending after openElection", async function () {
    const { voting } = await loadFixture(electionOpenFixture);
    await expect(voting.getZeresima()).to.be.revertedWithCustomError(
      voting,
      "ElectionNotPending"
    );
  });

  it("returns voterCount = 0 when no hashes are registered yet", async function () {
    const { voting } = await loadFixture(electionCreatedFixture);
    const z = await voting.getZeresima();
    expect(z.voterCount).to.equal(0n);
    expect(z.allZero).to.equal(true);
  });

  it("returns allZero = true with all candidate.voteCount == 0", async function () {
    const { voting } = await loadFixture(electionCreatedFixture);
    const z = await voting.getZeresima();
    expect(z.allZero).to.equal(true);
    for (const c of z._candidates) {
      expect(c.voteCount).to.equal(0n);
    }
  });
});
