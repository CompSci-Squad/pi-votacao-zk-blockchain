const { expect } = require("chai");
const { loadFixture, deployFixture } = require("./helpers/fixtures");

describe("VotingContract — deployment", function () {
  it("starts in PENDING state (0)", async function () {
    const { voting } = await loadFixture(deployFixture);
    expect(await voting.state()).to.equal(0n);
  });

  it("sets the deployer as admin", async function () {
    const { voting, admin } = await loadFixture(deployFixture);
    expect(await voting.admin()).to.equal(admin.address);
  });

  it("stores the verifier address", async function () {
    const { voting, mockVerifier } = await loadFixture(deployFixture);
    expect(await voting.verifier()).to.equal(await mockVerifier.getAddress());
  });

  it("starts with empty voter hashes", async function () {
    const { voting } = await loadFixture(deployFixture);
    expect((await voting.getVoterHashes()).length).to.equal(0);
  });

  it("starts with currentElectionId = 0 before createElection", async function () {
    const { voting } = await loadFixture(deployFixture);
    expect(await voting.currentElectionId()).to.equal(0n);
  });

  it("exposes POC_RACE_ID constant equal to 0", async function () {
    const { voting } = await loadFixture(deployFixture);
    expect(await voting.POC_RACE_ID()).to.equal(0n);
  });
});
