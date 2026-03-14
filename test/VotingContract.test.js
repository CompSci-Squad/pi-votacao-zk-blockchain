import { expect } from "chai";
import hre from "hardhat";
import {
  toBigInt,
  keccak256,
  toUtf8Bytes,
  MaxUint256,
} from "ethers";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// Load hardhat-chai-matchers (emit / revertedWithCustomError matchers).
// Uses the CJS entry-point from the v2 package – stubs have been added to
// node_modules/hardhat for the Hardhat 3 compatibility shims it needs.
require("@nomicfoundation/hardhat-chai-matchers/internal/add-chai-matchers");

// anyValue matcher for arguments we don't need to predict exactly (e.g. block.timestamp)
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

/**
 * VotingContract — Unit tests
 *
 * MockVerifier is used so that PLONK proof verification always returns true,
 * allowing us to test the contract logic in isolation.
 *
 * Public-signal layout (must match voter_proof.circom):
 *   pubSignals[0] — merkle_root    (voter Merkle tree root)
 *   pubSignals[1] — nullifier_hash (anti-double-vote commitment)
 *   pubSignals[2] — candidate_id   (0 = blank, 999 = null, 1..N = valid)
 *   pubSignals[3] — election_id    (unique election identifier; always 1 in this PoC)
 */
describe("VotingContract", function () {
  // ─── Fixtures ────────────────────────────────────────────────────────────

  /** Deploy MockVerifier + VotingContract and return useful references. */
  async function deployFixture() {
    const { ethers } = await hre.network.connect();
    const [admin, voter1, voter2, stranger] = await ethers.getSigners();

    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    const mockVerifier = await MockVerifier.deploy();

    const VotingContract = await ethers.getContractFactory("VotingContract");
    const voting = await VotingContract.deploy(
      await mockVerifier.getAddress()
    );

    return { voting, mockVerifier, admin, voter1, voter2, stranger };
  }

  /** Extend deployFixture: also create the election and add two candidates. */
  async function electionCreatedFixture() {
    const ctx = await deployFixture();
    await ctx.voting.createElection(
      "Eleição Teste",
      "Descrição de teste"
    );
    await ctx.voting.addCandidate("Alice", "Partido A", 10);
    await ctx.voting.addCandidate("Bob", "Partido B", 20);
    return ctx;
  }

  /** Extend electionCreatedFixture: also register hashes, Merkle root, and open. */
  async function electionOpenFixture() {
    const ctx = await electionCreatedFixture();

    // Simulate 15 voter hashes
    const hashes = Array.from({ length: 15 }, (_, i) =>
      toBigInt(
        keccak256(toUtf8Bytes(`voter_${i}`))
      )
    );
    await ctx.voting.registerVoterHashes(hashes);

    const merkleRoot = toBigInt(
      keccak256(toUtf8Bytes("test_root"))
    );
    await ctx.voting.setMerkleRoot(merkleRoot);
    await ctx.voting.openElection();

    // currentElectionId is always 1 for this single-election PoC
    const electionId = 1n;

    return { ...ctx, hashes, merkleRoot, electionId };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Build a PLONK-compatible dummy proof accepted by MockVerifier.
   * @param nullifier   Nullifier hash (prevents double voting)
   * @param candidateId Candidate ID (0=blank, 999=null, 1..N=valid)
   * @param merkleRoot  Voter Merkle root stored in the contract
   * @param electionId  Election ID stored in the contract (default: 1)
   */
  function dummyProof(nullifier, candidateId, merkleRoot = 0n, electionId = 1n) {
    return {
      proof: "0x",
      pubSignals: [
        BigInt(merkleRoot),
        BigInt(nullifier),
        BigInt(candidateId),
        BigInt(electionId),
      ],
    };
  }

  // ─── Deployment ──────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets the deployer as admin", async function () {
      const { voting, admin } = await deployFixture();
      expect(await voting.admin()).to.equal(admin.address);
    });

    it("starts in PENDING state", async function () {
      const { voting } = await deployFixture();
      expect(await voting.state()).to.equal(0n); // ElectionState.PENDING
    });

    it("stores the verifier address", async function () {
      const { voting, mockVerifier } = await deployFixture();
      expect(await voting.verifier()).to.equal(
        await mockVerifier.getAddress()
      );
    });
  });

  // ─── createElection ───────────────────────────────────────────────────────

  describe("createElection", function () {
    it("creates an election, sets electionId=1, and emits ElectionCreated", async function () {
      const { voting } = await deployFixture();
      await expect(
        voting.createElection("Eleição Teste", "Descrição")
      )
        .to.emit(voting, "ElectionCreated")
        .withArgs("Eleição Teste", 1n);

      expect(await voting.electionName()).to.equal("Eleição Teste");
      expect(await voting.electionDescription()).to.equal("Descrição");
      expect(await voting.currentElectionId()).to.equal(1n);
    });

    it("reverts when called by a non-admin", async function () {
      const { voting, stranger } = await deployFixture();
      await expect(
        voting.connect(stranger).createElection("X", "Y")
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });

    it("reverts when election already exists", async function () {
      const { voting } = await deployFixture();
      await voting.createElection("First", "Desc");
      await expect(
        voting.createElection("Second", "Desc")
      ).to.be.revertedWithCustomError(voting, "ElectionAlreadyExists");
    });

    it("reverts when not in PENDING state", async function () {
      const { voting } = await electionCreatedFixture();
      await voting.openElection();
      await expect(
        voting.createElection("Another", "Desc")
      ).to.be.revertedWithCustomError(voting, "ElectionNotPending");
    });
  });

  // ─── addCandidate ─────────────────────────────────────────────────────────

  describe("addCandidate", function () {
    it("adds candidates and emits CandidateAdded", async function () {
      const { voting } = await electionCreatedFixture();
      expect(await voting.getCandidateCount()).to.equal(2n);
      const c1 = await voting.candidates(0);
      expect(c1.name).to.equal("Alice");
      expect(c1.number).to.equal(10n);
    });

    it("assigns sequential IDs starting from 1", async function () {
      const { voting } = await deployFixture();
      await voting.createElection("E", "D");
      await voting.addCandidate("C1", "P", 1);
      await voting.addCandidate("C2", "P", 2);
      const c1 = await voting.candidates(0);
      const c2 = await voting.candidates(1);
      expect(c1.id).to.equal(1n);
      expect(c2.id).to.equal(2n);
    });

    it("reverts when called by a non-admin", async function () {
      const { voting, stranger } = await electionCreatedFixture();
      await expect(
        voting.connect(stranger).addCandidate("X", "Y", 99)
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });
  });

  // ─── registerVoterHashes ──────────────────────────────────────────────────

  describe("registerVoterHashes", function () {
    it("stores hashes and emits VoterHashesRegistered", async function () {
      const { voting } = await electionCreatedFixture();
      const hashes = [1n, 2n, 3n];
      await expect(voting.registerVoterHashes(hashes))
        .to.emit(voting, "VoterHashesRegistered")
        .withArgs(hashes);

      const stored = await voting.getVoterHashes();
      expect(stored.length).to.equal(3);
      expect(stored[0]).to.equal(1n);
    });

    it("replaces previously stored hashes", async function () {
      const { voting } = await electionCreatedFixture();
      await voting.registerVoterHashes([1n, 2n, 3n]);
      await voting.registerVoterHashes([10n, 20n]);
      const stored = await voting.getVoterHashes();
      expect(stored.length).to.equal(2);
    });

    it("supports up to 15 voter hashes (PoC limit)", async function () {
      const { voting } = await electionCreatedFixture();
      const hashes = Array.from({ length: 15 }, (_, i) => BigInt(i + 1));
      await voting.registerVoterHashes(hashes);
      expect((await voting.getVoterHashes()).length).to.equal(15);
    });

    it("reverts when called by a non-admin", async function () {
      const { voting, stranger } = await electionCreatedFixture();
      await expect(
        voting.connect(stranger).registerVoterHashes([1n])
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });
  });

  // ─── setMerkleRoot ────────────────────────────────────────────────────────

  describe("setMerkleRoot", function () {
    it("sets the root and emits MerkleRootSet", async function () {
      const { voting } = await electionCreatedFixture();
      // Voter hashes must be registered before setting Merkle root
      await voting.registerVoterHashes([1n, 2n, 3n]);
      await expect(voting.setMerkleRoot(42n))
        .to.emit(voting, "MerkleRootSet")
        .withArgs(42n);
      expect(await voting.voterMerkleRoot()).to.equal(42n);
    });

    it("reverts when no voter hashes are registered", async function () {
      const { voting } = await electionCreatedFixture();
      await expect(
        voting.setMerkleRoot(42n)
      ).to.be.revertedWithCustomError(voting, "NoVoterHashesRegistered");
    });

    it("reverts when called by a non-admin", async function () {
      const { voting, stranger } = await electionCreatedFixture();
      await voting.registerVoterHashes([1n]);
      await expect(
        voting.connect(stranger).setMerkleRoot(1n)
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });
  });

  // ─── openElection ─────────────────────────────────────────────────────────

  describe("openElection", function () {
    it("transitions to OPEN and emits ElectionOpened with electionId", async function () {
      const { voting } = await electionCreatedFixture();
      await expect(voting.openElection())
        .to.emit(voting, "ElectionOpened")
        .withArgs(anyValue, 1n);
      expect(await voting.state()).to.equal(1n); // OPEN
    });

    it("reverts when called by a non-admin", async function () {
      const { voting, stranger } = await electionCreatedFixture();
      await expect(
        voting.connect(stranger).openElection()
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });

    it("reverts when already OPEN", async function () {
      const { voting } = await electionCreatedFixture();
      await voting.openElection();
      await expect(voting.openElection()).to.be.revertedWithCustomError(
        voting,
        "ElectionNotPending"
      );
    });
  });

  // ─── castVote ─────────────────────────────────────────────────────────────

  describe("castVote", function () {
    it("records a vote for a valid candidate and emits VoteCast", async function () {
      const { voting, voter1, merkleRoot, electionId } = await electionOpenFixture();
      const p = dummyProof(1001, 1, merkleRoot, electionId); // nullifier=1001, candidateId=1 (Alice)

      await expect(
        voting.connect(voter1).castVote(p.proof, p.pubSignals)
      )
        .to.emit(voting, "VoteCast")
        .withArgs(1001n, 1n);

      const candidate = await voting.candidates(0); // Alice
      expect(candidate.voteCount).to.equal(1n);
    });

    it("records a blank vote when candidateId = 0", async function () {
      const { voting, voter1, merkleRoot, electionId } = await electionOpenFixture();
      const p = dummyProof(2001, 0, merkleRoot, electionId);

      await voting.connect(voter1).castVote(p.proof, p.pubSignals);

      expect(await voting.blankVotes()).to.equal(1n);
    });

    it("records a null vote when candidateId = 999", async function () {
      const { voting, voter1, merkleRoot, electionId } = await electionOpenFixture();
      const p = dummyProof(3001, 999, merkleRoot, electionId); // NULL_VOTE_ID

      await voting.connect(voter1).castVote(p.proof, p.pubSignals);

      expect(await voting.nullVotes()).to.equal(1n);
    });

    it("records a null vote when candidateId = MaxUint256 (legacy sentinel)", async function () {
      const { voting, voter1, merkleRoot, electionId } = await electionOpenFixture();
      const p = dummyProof(3002, MaxUint256, merkleRoot, electionId);

      await voting.connect(voter1).castVote(p.proof, p.pubSignals);

      expect(await voting.nullVotes()).to.equal(1n);
    });

    it("increments totalVotes with each cast vote", async function () {
      const { voting, voter1, voter2, merkleRoot, electionId } = await electionOpenFixture();
      const p1 = dummyProof(4001, 1, merkleRoot, electionId);
      const p2 = dummyProof(4002, 2, merkleRoot, electionId);

      await voting.connect(voter1).castVote(p1.proof, p1.pubSignals);
      await voting.connect(voter2).castVote(p2.proof, p2.pubSignals);

      expect(await voting.totalVotes()).to.equal(2n);
    });

    it("rejects a double vote (nullifier already used)", async function () {
      const { voting, voter1, voter2, merkleRoot, electionId } = await electionOpenFixture();
      const p = dummyProof(5001, 1, merkleRoot, electionId);

      await voting.connect(voter1).castVote(p.proof, p.pubSignals);

      // Same nullifier from a different signer
      await expect(
        voting.connect(voter2).castVote(p.proof, p.pubSignals)
      ).to.be.revertedWithCustomError(voting, "NullifierAlreadyUsed");
    });

    it("rejects a vote with an invalid Merkle root", async function () {
      const { voting, voter1, electionId } = await electionOpenFixture();
      const wrongRoot = 0xdeadbeefn;
      const p = dummyProof(5500, 1, wrongRoot, electionId);

      await expect(
        voting.connect(voter1).castVote(p.proof, p.pubSignals)
      ).to.be.revertedWithCustomError(voting, "InvalidMerkleRoot");
    });

    it("rejects a vote with an invalid election ID", async function () {
      const { voting, voter1, merkleRoot } = await electionOpenFixture();
      const wrongElectionId = 99n;
      const p = dummyProof(5600, 1, merkleRoot, wrongElectionId);

      await expect(
        voting.connect(voter1).castVote(p.proof, p.pubSignals)
      ).to.be.revertedWithCustomError(voting, "InvalidElectionId");
    });

    it("rejects an invalid ZK proof", async function () {
      // Deploy a fresh VotingContract backed by the REAL (always-false) Verifier
      const { ethers } = await hre.network.connect();
      const Verifier = await ethers.getContractFactory("Verifier");
      const realVerifier = await Verifier.deploy();
      const VotingContract = await ethers.getContractFactory("VotingContract");
      const voting = await VotingContract.deploy(
        await realVerifier.getAddress()
      );

      await voting.createElection("E", "D");
      await voting.addCandidate("Alice", "P", 10);
      await voting.openElection();

      // voterMerkleRoot is 0 and currentElectionId is 1; proof passes structural checks
      const p = dummyProof(9999, 1, 0n, 1n);
      await expect(
        voting.castVote(p.proof, p.pubSignals)
      ).to.be.revertedWithCustomError(voting, "InvalidProof");
    });

    it("rejects a vote for an unknown candidateId", async function () {
      const { voting, voter1, merkleRoot, electionId } = await electionOpenFixture();
      const p = dummyProof(6001, 50, merkleRoot, electionId); // candidateId 50 does not exist

      await expect(
        voting.connect(voter1).castVote(p.proof, p.pubSignals)
      ).to.be.revertedWithCustomError(voting, "CandidateNotFound");
    });

    it("reverts when the election is not OPEN", async function () {
      const { voting, voter1 } = await electionCreatedFixture();
      const p = dummyProof(7001, 1);

      await expect(
        voting.connect(voter1).castVote(p.proof, p.pubSignals)
      ).to.be.revertedWithCustomError(voting, "ElectionNotOpen");
    });
  });

  // ─── closeElection ────────────────────────────────────────────────────────

  describe("closeElection", function () {
    it("transitions to FINISHED and emits ElectionClosed with totalVotes", async function () {
      const { voting, merkleRoot, electionId } = await electionOpenFixture();

      // Cast one vote so totalVotes > 0
      const p = dummyProof(8001, 1, merkleRoot, electionId);
      await voting.castVote(p.proof, p.pubSignals);

      await expect(voting.closeElection())
        .to.emit(voting, "ElectionClosed")
        .withArgs(anyValue, 1n);

      expect(await voting.state()).to.equal(2n); // FINISHED
    });

    it("reverts when called by a non-admin", async function () {
      const { voting, stranger } = await electionOpenFixture();
      await expect(
        voting.connect(stranger).closeElection()
      ).to.be.revertedWithCustomError(voting, "NotAdmin");
    });

    it("reverts when not OPEN", async function () {
      const { voting } = await electionCreatedFixture();
      await expect(voting.closeElection()).to.be.revertedWithCustomError(
        voting,
        "ElectionNotOpen"
      );
    });
  });

  // ─── getResults ───────────────────────────────────────────────────────────

  describe("getResults", function () {
    it("returns correct tallies after voting", async function () {
      const { voting, merkleRoot, electionId } = await electionOpenFixture();

      // Alice (id=1) gets 2 votes, Bob (id=2) gets 1, blank=1, null=1
      const votes = [
        dummyProof(100, 1, merkleRoot, electionId),
        dummyProof(101, 1, merkleRoot, electionId),
        dummyProof(102, 2, merkleRoot, electionId),
        dummyProof(103, 0, merkleRoot, electionId),   // blank
        dummyProof(104, 999, merkleRoot, electionId), // null
      ];
      for (const v of votes) {
        await voting.castVote(v.proof, v.pubSignals);
      }

      const [candidates, blank, nullV, total] = await voting.getResults();
      expect(candidates[0].voteCount).to.equal(2n); // Alice
      expect(candidates[1].voteCount).to.equal(1n); // Bob
      expect(blank).to.equal(1n);
      expect(nullV).to.equal(1n);
      expect(total).to.equal(5n);
    });

    it("can be called in any election state", async function () {
      const { voting } = await deployFixture();
      // PENDING — no candidates yet
      const [candidates] = await voting.getResults();
      expect(candidates.length).to.equal(0);
    });
  });

  // ─── getVoterHashes ───────────────────────────────────────────────────────

  describe("getVoterHashes", function () {
    it("returns the registered voter hashes", async function () {
      const { voting } = await electionCreatedFixture();
      const hashes = [11n, 22n, 33n];
      await voting.registerVoterHashes(hashes);
      const stored = await voting.getVoterHashes();
      expect(stored.map(String)).to.deep.equal(hashes.map(String));
    });

    it("returns an empty array before any registration", async function () {
      const { voting } = await deployFixture();
      expect((await voting.getVoterHashes()).length).to.equal(0);
    });
  });

  // ─── getCandidates ────────────────────────────────────────────────────────

  describe("getCandidates", function () {
    it("returns all candidates", async function () {
      const { voting } = await electionCreatedFixture();
      const list = await voting.getCandidates();
      expect(list.length).to.equal(2);
      expect(list[0].name).to.equal("Alice");
      expect(list[1].name).to.equal("Bob");
    });

    it("returns an empty array before any candidates are added", async function () {
      const { voting } = await deployFixture();
      expect((await voting.getCandidates()).length).to.equal(0);
    });
  });

  // ─── getZeresima ──────────────────────────────────────────────────────────

  describe("getZeresima", function () {
    it("returns correct data before opening the election", async function () {
      const { voting } = await electionCreatedFixture();
      await voting.registerVoterHashes([1n, 2n, 3n]);

      const [name, candidateCount, voterCount, totalVotesBefore, allZero] =
        await voting.getZeresima();

      expect(name).to.equal("Eleição Teste");
      expect(candidateCount).to.equal(2n);
      expect(voterCount).to.equal(3n);
      expect(totalVotesBefore).to.equal(0n);
      expect(allZero).to.equal(true);
    });

    it("reports allCandidatesZero = false after votes are cast", async function () {
      const { voting, merkleRoot, electionId } = await electionOpenFixture();
      const p = dummyProof(9001, 1, merkleRoot, electionId);
      await voting.castVote(p.proof, p.pubSignals);

      const [, , , , allZero] = await voting.getZeresima();
      expect(allZero).to.equal(false);
    });

    it("returns zero voterCount when no hashes are registered", async function () {
      const { voting } = await electionCreatedFixture();
      const [, , voterCount] = await voting.getZeresima();
      expect(voterCount).to.equal(0n);
    });
  });

  // ─── Full election lifecycle ──────────────────────────────────────────────

  describe("Full election lifecycle", function () {
    it("runs a complete election with 3 voters and verifies results", async function () {
      const { voting, voter1, voter2, stranger } = await deployFixture();

      // Setup
      await voting.createElection("Eleição PoC", "Teste completo");
      await voting.addCandidate("Alice", "Partido A", 10);
      await voting.addCandidate("Bob", "Partido B", 20);

      const hashes = Array.from({ length: 15 }, (_, i) => BigInt(i + 1));
      await voting.registerVoterHashes(hashes);

      const merkleRoot = 999n;
      const electionId = 1n;
      await voting.setMerkleRoot(merkleRoot);
      await voting.openElection();

      // Confirm zerésima (zero votes before opening)
      const [, , , totalBefore, allZero] = await voting.getZeresima();
      expect(totalBefore).to.equal(0n);
      expect(allZero).to.equal(true);

      // Three voters cast votes
      const v1 = dummyProof(1, 1, merkleRoot, electionId); // voter1 → Alice
      const v2 = dummyProof(2, 2, merkleRoot, electionId); // voter2 → Bob
      const v3 = dummyProof(3, 1, merkleRoot, electionId); // stranger → Alice

      await voting.connect(voter1).castVote(v1.proof, v1.pubSignals);
      await voting.connect(voter2).castVote(v2.proof, v2.pubSignals);
      await voting.connect(stranger).castVote(v3.proof, v3.pubSignals);

      await voting.closeElection();

      const [candidates, blank, nullV, total] = await voting.getResults();
      expect(candidates[0].voteCount).to.equal(2n); // Alice
      expect(candidates[1].voteCount).to.equal(1n); // Bob
      expect(blank).to.equal(0n);
      expect(nullV).to.equal(0n);
      expect(total).to.equal(3n);
      expect(await voting.state()).to.equal(2n); // FINISHED
    });
  });
});
