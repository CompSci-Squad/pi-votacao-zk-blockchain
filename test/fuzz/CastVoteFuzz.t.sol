// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../helpers/BaseTest.sol";
import {VotingContract} from "../../src/VotingContract.sol";

/// @notice Property-based tests for castVote.
contract CastVoteFuzzTest is BaseTest {
    function setUp() public {
        _setUpOpen();
    }

    /// @notice Any non-zero, non-duplicated nullifier paired with a valid candidateId
    ///         must be accepted on the first call and rejected on the second.
    function testFuzz_CastVote_NullifierUniqueness(uint256 nullifier, uint8 candId) public {
        vm.assume(nullifier != 0);
        uint256 candidateId = bound(uint256(candId), 1, 2); // only registered candidates 1..2
        uint256[5] memory s = _pubSignals(nullifier, candidateId);

        voting.castVote(POC_RACE_ID, s, _emptyProof());
        assertTrue(voting.nullifiers(POC_RACE_ID, nullifier));

        // Second call must revert with NullifierAlreadyUsed.
        vm.expectRevert(abi.encodeWithSelector(VotingContract.NullifierAlreadyUsed.selector, nullifier));
        voting.castVote(POC_RACE_ID, s, _emptyProof());
    }

    /// @notice candidateId outside {0, 1..N, 999} must always revert CandidateNotFound.
    function testFuzz_CastVote_RevertOnInvalidCandidate(uint256 nullifier, uint256 candidateId) public {
        vm.assume(nullifier != 0);
        // Exclude all valid IDs: 0 (blank), 1..2 (registered), 999 (null).
        vm.assume(candidateId != 0);
        vm.assume(candidateId != 1);
        vm.assume(candidateId != 2);
        vm.assume(candidateId != 999);

        uint256[5] memory s = _pubSignals(nullifier, candidateId);
        vm.expectRevert(abi.encodeWithSelector(VotingContract.CandidateNotFound.selector, candidateId));
        voting.castVote(POC_RACE_ID, s, _emptyProof());
    }

    /// @notice Any merkle root != on-chain root must revert.
    function testFuzz_CastVote_RevertOnWrongMerkleRoot(uint256 wrongRoot) public {
        vm.assume(wrongRoot != MERKLE_ROOT);
        uint256[5] memory s = _pubSignalsCustom(wrongRoot, _makeNullifier(0), 1, ELECTION_ID, POC_RACE_ID);
        vm.expectRevert(
            abi.encodeWithSelector(VotingContract.InvalidMerkleRoot.selector, wrongRoot, MERKLE_ROOT)
        );
        voting.castVote(POC_RACE_ID, s, _emptyProof());
    }

    /// @notice Any election id != currentElectionId must revert.
    function testFuzz_CastVote_RevertOnWrongElectionId(uint256 wrongElectionId) public {
        vm.assume(wrongElectionId != ELECTION_ID);
        uint256[5] memory s = _pubSignalsCustom(MERKLE_ROOT, _makeNullifier(0), 1, wrongElectionId, POC_RACE_ID);
        vm.expectRevert(
            abi.encodeWithSelector(VotingContract.InvalidElectionId.selector, wrongElectionId, ELECTION_ID)
        );
        voting.castVote(POC_RACE_ID, s, _emptyProof());
    }

    /// @notice raceId param != POC_RACE_ID must always revert InvalidRaceId,
    ///         regardless of pubSignals[4].
    function testFuzz_CastVote_RevertOnNonZeroRaceParam(uint256 raceParam, uint256 sigRaceId) public {
        vm.assume(raceParam != 0);
        uint256[5] memory s = _pubSignalsCustom(MERKLE_ROOT, _makeNullifier(0), 1, ELECTION_ID, sigRaceId);
        vm.expectRevert(abi.encodeWithSelector(VotingContract.InvalidRaceId.selector, raceParam));
        voting.castVote(raceParam, s, _emptyProof());
    }
}
