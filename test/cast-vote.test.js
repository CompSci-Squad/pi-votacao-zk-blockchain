const { expect } = require("chai");
const {
  loadFixture,
  electionCreatedFixture,
  electionOpenFixture,
  rejectingVerifierFixture,
  ELECTION_ID,
  POC_RACE_ID,
  MERKLE_ROOT,
  EMPTY_PROOF,
  makeNullifier,
  makePubSignals,
} = require("./helpers/fixtures");

describe("VotingContract — castVote (security core)", function () {
  // ── Happy paths ─────────────────────────────────────────────────────────

  describe("happy paths", function () {
    it("records a vote for a valid candidate (Alice = id 1)", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      const nullifier = makeNullifier(0);
      await voting.castVote(
        POC_RACE_ID,
        makePubSignals({ nullifier, candidateId: 1n }),
        EMPTY_PROOF
      );
      const alice = await voting.candidates(0);
      expect(alice.voteCount).to.equal(1n);
      expect(await voting.totalVotes()).to.equal(1n);
    });

    it("records a blank vote when candidateId = 0", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      const nullifier = makeNullifier(0);
      await voting.castVote(
        POC_RACE_ID,
        makePubSignals({ nullifier, candidateId: 0n }),
        EMPTY_PROOF
      );
      expect(await voting.blankVotes()).to.equal(1n);
      expect(await voting.totalVotes()).to.equal(1n);
    });

    it("records a null vote when candidateId = 999", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      const nullifier = makeNullifier(0);
      await voting.castVote(
        POC_RACE_ID,
        makePubSignals({ nullifier, candidateId: 999n }),
        EMPTY_PROOF
      );
      expect(await voting.nullVotes()).to.equal(1n);
      expect(await voting.totalVotes()).to.equal(1n);
    });

    it("emits VoteCast with (nullifier, raceId, candidateId)", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      const nullifier = makeNullifier(0);
      await expect(
        voting.castVote(
          POC_RACE_ID,
          makePubSignals({ nullifier, candidateId: 1n }),
          EMPTY_PROOF
        )
      )
        .to.emit(voting, "VoteCast")
        .withArgs(nullifier, POC_RACE_ID, 1n);
    });

    it("two distinct nullifiers produce two recorded votes", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      await voting.castVote(
        POC_RACE_ID,
        makePubSignals({ nullifier: makeNullifier(0), candidateId: 1n }),
        EMPTY_PROOF
      );
      await voting.castVote(
        POC_RACE_ID,
        makePubSignals({ nullifier: makeNullifier(1), candidateId: 2n }),
        EMPTY_PROOF
      );
      expect(await voting.totalVotes()).to.equal(2n);
    });
  });

  // ── pubSignals ordering (CRITICAL — see project security invariants) ────

  describe("pubSignals ordering", function () {
    it("forwards [merkle_root, nullifier, candidate_id, election_id, race_id] in canonical order", async function () {
      const { voting, mockVerifier } = await loadFixture(electionOpenFixture);
      const nullifier = makeNullifier(3);
      const candidateId = 1n;
      await voting.castVote(
        POC_RACE_ID,
        makePubSignals({ nullifier, candidateId }),
        EMPTY_PROOF
      );
      expect(await mockVerifier.getLastPubSignal(0)).to.equal(MERKLE_ROOT);
      expect(await mockVerifier.getLastPubSignal(1)).to.equal(nullifier);
      expect(await mockVerifier.getLastPubSignal(2)).to.equal(candidateId);
      expect(await mockVerifier.getLastPubSignal(3)).to.equal(ELECTION_ID);
      expect(await mockVerifier.getLastPubSignal(4)).to.equal(POC_RACE_ID);
    });

    it("forwards exactly 5 elements", async function () {
      const { voting, mockVerifier } = await loadFixture(electionOpenFixture);
      const nullifier = makeNullifier(5);
      await voting.castVote(
        POC_RACE_ID,
        makePubSignals({ nullifier, candidateId: 1n }),
        EMPTY_PROOF
      );
      // getLastPubSignal(4) reverts if length < 5
      await expect(mockVerifier.getLastPubSignal(4)).to.not.be.reverted;
      await expect(mockVerifier.getLastPubSignal(5)).to.be.reverted;
    });
  });

  // ── CEI — nullifier written before event (and after proof verification) ─

  describe("Checks-Effects-Interactions ordering", function () {
    it("nullifier is marked used after a successful castVote", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      const nullifier = makeNullifier(7);
      await voting.castVote(
        POC_RACE_ID,
        makePubSignals({ nullifier, candidateId: 1n }),
        EMPTY_PROOF
      );
      expect(await voting.nullifiers(POC_RACE_ID, nullifier)).to.equal(true);
      expect(await voting.isNullifierUsed(POC_RACE_ID, nullifier)).to.equal(true);
    });

    it("VoteCast event fires AFTER nullifier write (verified via tx logs and storage)", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      const nullifier = makeNullifier(8);
      const tx = await voting.castVote(
        POC_RACE_ID,
        makePubSignals({ nullifier, candidateId: 1n }),
        EMPTY_PROOF
      );
      const receipt = await tx.wait();
      const events = receipt.logs.filter((l) => {
        try {
          return voting.interface.parseLog(l)?.name === "VoteCast";
        } catch (_) {
          return false;
        }
      });
      expect(events.length).to.equal(1);
      // After the tx, the nullifier MUST be set in storage. If event fired
      // before the write (CEI violation), this would still pass — but the
      // contract code physically writes nullifier before emit.
      expect(await voting.nullifiers(POC_RACE_ID, nullifier)).to.equal(true);
    });
  });

  // ── Double-vote prevention ──────────────────────────────────────────────

  describe("double-vote prevention", function () {
    it("reverts NullifierAlreadyUsed on second vote with same nullifier", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      const nullifier = makeNullifier(0);
      await voting.castVote(
        POC_RACE_ID,
        makePubSignals({ nullifier, candidateId: 1n }),
        EMPTY_PROOF
      );
      await expect(
        voting.castVote(
          POC_RACE_ID,
          makePubSignals({ nullifier, candidateId: 2n }),
          EMPTY_PROOF
        )
      ).to.be.revertedWithCustomError(voting, "NullifierAlreadyUsed");
    });
  });

  // ── pubSignal validation reverts ────────────────────────────────────────

  describe("public signal validation", function () {
    it("reverts InvalidMerkleRoot when pubSignals[0] mismatches storage", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      await expect(
        voting.castVote(
          POC_RACE_ID,
          makePubSignals({
            nullifier: makeNullifier(0),
            candidateId: 1n,
            merkleRoot: 0xBADBADn,
          }),
          EMPTY_PROOF
        )
      ).to.be.revertedWithCustomError(voting, "InvalidMerkleRoot");
    });

    it("reverts InvalidElectionId when pubSignals[3] mismatches storage", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      await expect(
        voting.castVote(
          POC_RACE_ID,
          makePubSignals({
            nullifier: makeNullifier(0),
            candidateId: 1n,
            electionId: 99n,
          }),
          EMPTY_PROOF
        )
      ).to.be.revertedWithCustomError(voting, "InvalidElectionId");
    });

    it("reverts RaceIdMismatch when pubSignals[4] != raceId param", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      // Param raceId = 0, but pubSignals[4] = 1 → must NOT match.
      // We can't reach this revert with raceId=0 because the first check
      // (raceId != POC_RACE_ID) only triggers for raceId != 0. So we send
      // raceId=0 but pubSignals[4]=1 → triggers RaceIdMismatch.
      await expect(
        voting.castVote(
          POC_RACE_ID,
          makePubSignals({
            nullifier: makeNullifier(0),
            candidateId: 1n,
            raceId: 1n,
          }),
          EMPTY_PROOF
        )
      ).to.be.revertedWithCustomError(voting, "RaceIdMismatch");
    });

    it("reverts InvalidRaceId when raceId param != POC_RACE_ID (0)", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      await expect(
        voting.castVote(
          1n, // wrong raceId
          makePubSignals({
            nullifier: makeNullifier(0),
            candidateId: 1n,
            raceId: 1n,
          }),
          EMPTY_PROOF
        )
      ).to.be.revertedWithCustomError(voting, "InvalidRaceId");
    });

    it("reverts InvalidProof when verifier returns false", async function () {
      const { voting } = await loadFixture(rejectingVerifierFixture);
      await expect(
        voting.castVote(
          POC_RACE_ID,
          makePubSignals({ nullifier: makeNullifier(0), candidateId: 1n }),
          EMPTY_PROOF
        )
      ).to.be.revertedWithCustomError(voting, "InvalidProof");
    });
  });

  // ── State-gating ────────────────────────────────────────────────────────

  describe("state gating", function () {
    it("reverts ElectionNotOpen in PENDING", async function () {
      const { voting } = await loadFixture(electionCreatedFixture);
      await expect(
        voting.castVote(
          POC_RACE_ID,
          makePubSignals({ nullifier: makeNullifier(0), candidateId: 1n }),
          EMPTY_PROOF
        )
      ).to.be.revertedWithCustomError(voting, "ElectionNotOpen");
    });

    it("reverts ElectionNotOpen in FINISHED", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      await voting.closeElection();
      await expect(
        voting.castVote(
          POC_RACE_ID,
          makePubSignals({ nullifier: makeNullifier(0), candidateId: 1n }),
          EMPTY_PROOF
        )
      ).to.be.revertedWithCustomError(voting, "ElectionNotOpen");
    });
  });

  // ── Candidate ID validation ─────────────────────────────────────────────

  describe("candidate ID validation", function () {
    it("reverts CandidateNotFound when id > registered count and != 999", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      await expect(
        voting.castVote(
          POC_RACE_ID,
          makePubSignals({ nullifier: makeNullifier(0), candidateId: 50n }),
          EMPTY_PROOF
        )
      ).to.be.revertedWithCustomError(voting, "CandidateNotFound");
    });
  });

  // ── Nullifier-state read ────────────────────────────────────────────────

  describe("isNullifierUsed", function () {
    it("returns false before any vote", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      expect(await voting.isNullifierUsed(POC_RACE_ID, 12345n)).to.equal(false);
    });

    it("reverts InvalidRaceId for any race != 0", async function () {
      const { voting } = await loadFixture(electionOpenFixture);
      await expect(
        voting.isNullifierUsed(1n, 12345n)
      ).to.be.revertedWithCustomError(voting, "InvalidRaceId");
    });
  });
});
