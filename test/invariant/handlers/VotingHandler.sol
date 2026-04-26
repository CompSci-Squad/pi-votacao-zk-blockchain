// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VotingContract} from "../../../src/VotingContract.sol";
import {MockVerifier} from "../../mocks/MockVerifier.sol";

/// @notice Bounded action handler for invariant fuzzing.
///         Drives the contract through realistic sequences:
///           - admin setup (PENDING)
///           - openElection (→ OPEN)
///           - castVote with random nullifier/candidateId
///           - closeElection (→ FINISHED)
///         Tracks ghost state used by the invariant assertions.
contract VotingHandler is Test {
    VotingContract public voting;
    MockVerifier public mockVerifier;

    uint256 public constant POC_RACE_ID = 0;
    uint256 public constant ELECTION_ID = 1;
    uint256 public constant MERKLE_ROOT = 0xDEADBEEFCAFEBABE;
    uint256 public constant BLANK_VOTE = 0;
    uint256 public constant NULL_VOTE = 999;
    uint256 public constant MAX_VOTERS = 16;

    // ─── ghost state ─────────────────────────────────────────────────────
    uint256 public ghostTotalVotes;
    uint256 public ghostBlankVotes;
    uint256 public ghostNullVotes;
    mapping(uint256 => uint256) public ghostCandidateVotes; // id -> count
    mapping(uint256 => bool) public ghostNullifierSeen;

    /// @dev Tracks max state value ever reached. Enum values:
    ///  PENDING=0, OPEN=1, FINISHED=2.
    uint256 public ghostMaxState;

    constructor() {
        mockVerifier = new MockVerifier();
        voting = new VotingContract(address(mockVerifier));
        voting.createElection("InvE", "InvD");
        voting.addCandidate("A", "PT", 13);
        voting.addCandidate("B", "PSD", 45);

        uint256[] memory h = new uint256[](15);
        for (uint256 i = 0; i < 15; i++) h[i] = uint256(0xAAAA0000) + (i + 1);
        voting.registerVoterHashes(h);
        voting.setMerkleRoot(MERKLE_ROOT);
        voting.openElection();
        ghostMaxState = 1; // OPEN
    }

    // ─── handler actions ─────────────────────────────────────────────────

    function castVote(uint256 nullifier, uint8 candRaw) external {
        // Constrain to the realistic candidate-id space: blank, 1..2, null.
        uint256 candidateId;
        uint256 mod_ = candRaw % 4;
        if (mod_ == 0) candidateId = BLANK_VOTE;
        else if (mod_ == 1) candidateId = 1;
        else if (mod_ == 2) candidateId = 2;
        else candidateId = NULL_VOTE;

        if (nullifier == 0) nullifier = 1;

        uint256[5] memory s;
        s[0] = MERKLE_ROOT;
        s[1] = nullifier;
        s[2] = candidateId;
        s[3] = ELECTION_ID;
        s[4] = POC_RACE_ID;
        uint256[24] memory p;

        // Skip if already used (handler skips invalid call instead of reverting).
        if (ghostNullifierSeen[nullifier]) return;
        // Skip if already FINISHED.
        if (uint256(voting.state()) != uint256(VotingContract.ElectionState.OPEN)) return;

        try voting.castVote(POC_RACE_ID, s, p) {
            ghostNullifierSeen[nullifier] = true;
            ghostTotalVotes++;
            if (candidateId == BLANK_VOTE) ghostBlankVotes++;
            else if (candidateId == NULL_VOTE) ghostNullVotes++;
            else ghostCandidateVotes[candidateId]++;
        } catch {
            // Any unexpected revert is a real bug — surface via invariant later.
        }
    }

    function closeElection(uint8 trigger) external {
        // Only ~1/8 of calls actually try to close, to keep election OPEN longer.
        if (trigger % 8 != 0) return;
        if (uint256(voting.state()) != uint256(VotingContract.ElectionState.OPEN)) return;
        voting.closeElection();
        ghostMaxState = 2;
    }
}
