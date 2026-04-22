const { expect } = require("chai");
const {
  loadFixture,
  electionCreatedFixture,
  electionOpenFixture,
  POC_RACE_ID,
  EMPTY_PROOF,
  makeNullifier,
  makePubSignals,
} = require("./helpers/fixtures");

describe("VotingContract — read functions / results", function () {
  it("getResults returns zeros initially after openElection", async function () {
    const { voting } = await loadFixture(electionOpenFixture);
    const r = await voting.getResults();
    expect(r._blankVotes).to.equal(0n);
    expect(r._nullVotes).to.equal(0n);
    expect(r._totalVotes).to.equal(0n);
    for (const c of r._candidates) expect(c.voteCount).to.equal(0n);
  });

  it("getResults reflects tallies after several votes", async function () {
    const { voting } = await loadFixture(electionOpenFixture);
    // Alice (id=1) gets 2 votes; Bob (id=2) gets 1; blank=1; null=1.
    const sequence = [
      [1n, makeNullifier(0)],
      [1n, makeNullifier(1)],
      [2n, makeNullifier(2)],
      [0n, makeNullifier(3)],
      [999n, makeNullifier(4)],
    ];
    for (const [candidateId, nullifier] of sequence) {
      await voting.castVote(
        POC_RACE_ID,
        makePubSignals({ nullifier, candidateId }),
        EMPTY_PROOF
      );
    }
    const r = await voting.getResults();
    expect(r._candidates[0].voteCount).to.equal(2n);
    expect(r._candidates[1].voteCount).to.equal(1n);
    expect(r._blankVotes).to.equal(1n);
    expect(r._nullVotes).to.equal(1n);
    expect(r._totalVotes).to.equal(5n);
  });

  it("getRaceResults(0) is the canonical accessor (multi-race-ready)", async function () {
    const { voting } = await loadFixture(electionOpenFixture);
    const r = await voting.getRaceResults(POC_RACE_ID);
    expect(r._candidates.length).to.equal(2);
  });

  it("getRaceResults reverts InvalidRaceId for any race != 0", async function () {
    const { voting } = await loadFixture(electionOpenFixture);
    await expect(
      voting.getRaceResults(1n)
    ).to.be.revertedWithCustomError(voting, "InvalidRaceId");
  });

  it("getCandidates() returns all registered candidates", async function () {
    const { voting } = await loadFixture(electionCreatedFixture);
    const list = await voting.getCandidates();
    expect(list.length).to.equal(2);
  });

  it("getCandidatesByRace(0) returns all candidates", async function () {
    const { voting } = await loadFixture(electionCreatedFixture);
    const list = await voting.getCandidatesByRace(POC_RACE_ID);
    expect(list.length).to.equal(2);
  });

  it("getCandidatesByRace reverts InvalidRaceId for any race != 0", async function () {
    const { voting } = await loadFixture(electionCreatedFixture);
    await expect(
      voting.getCandidatesByRace(1n)
    ).to.be.revertedWithCustomError(voting, "InvalidRaceId");
  });

  it("getCandidateCount returns the right number", async function () {
    const { voting } = await loadFixture(electionCreatedFixture);
    expect(await voting.getCandidateCount()).to.equal(2n);
  });
});
