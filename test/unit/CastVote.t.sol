// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../helpers/BaseTest.sol";
import {VotingContract} from "../../src/VotingContract.sol";
import {RejectingMockVerifier} from "../mocks/RejectingMockVerifier.sol";

contract CastVoteTest is BaseTest {
    function setUp() public {
        _setUpOpen();
    }

    // ── happy paths ──────────────────────────────────────────────────────

    function test_CastVote_RecordsCandidateVote() public {
        uint256 nul = _makeNullifier(0);
        voting.castVote(POC_RACE_ID, _pubSignals(nul, 1), _emptyProof());
        (,,,, uint256 voteCount) = voting.candidates(0);
        assertEq(voteCount, 1);
        assertEq(voting.totalVotes(), 1);
    }

    function test_CastVote_RecordsBlankVote() public {
        uint256 nul = _makeNullifier(0);
        voting.castVote(POC_RACE_ID, _pubSignals(nul, BLANK_VOTE), _emptyProof());
        assertEq(voting.blankVotes(), 1);
        assertEq(voting.totalVotes(), 1);
    }

    function test_CastVote_RecordsNullVote() public {
        uint256 nul = _makeNullifier(0);
        voting.castVote(POC_RACE_ID, _pubSignals(nul, NULL_VOTE), _emptyProof());
        assertEq(voting.nullVotes(), 1);
        assertEq(voting.totalVotes(), 1);
    }

    function test_CastVote_EmitsVoteCast() public {
        uint256 nul = _makeNullifier(0);
        vm.expectEmit(true, true, true, true);
        emit VotingContract.VoteCast(nul, POC_RACE_ID, 1);
        voting.castVote(POC_RACE_ID, _pubSignals(nul, 1), _emptyProof());
    }

    function test_CastVote_TwoDistinctNullifiers() public {
        voting.castVote(POC_RACE_ID, _pubSignals(_makeNullifier(0), 1), _emptyProof());
        voting.castVote(POC_RACE_ID, _pubSignals(_makeNullifier(1), 2), _emptyProof());
        assertEq(voting.totalVotes(), 2);
    }

    // ── pubSignals canonical order ───────────────────────────────────────

    function test_CastVote_ForwardsPubSignalsInCanonicalOrder() public {
        uint256 nul = _makeNullifier(3);
        voting.castVote(POC_RACE_ID, _pubSignals(nul, 1), _emptyProof());
        assertEq(mockVerifier.getLastPubSignal(0), MERKLE_ROOT);
        assertEq(mockVerifier.getLastPubSignal(1), nul);
        assertEq(mockVerifier.getLastPubSignal(2), 1);
        assertEq(mockVerifier.getLastPubSignal(3), ELECTION_ID);
        assertEq(mockVerifier.getLastPubSignal(4), POC_RACE_ID);
        assertTrue(mockVerifier.called());
    }

    // ── Effects: nullifier marked used ───────────────────────────────────

    function test_CastVote_NullifierMarkedUsed() public {
        uint256 nul = _makeNullifier(7);
        voting.castVote(POC_RACE_ID, _pubSignals(nul, 1), _emptyProof());
        assertTrue(voting.nullifiers(POC_RACE_ID, nul));
        assertTrue(voting.isNullifierUsed(POC_RACE_ID, nul));
    }

    // ── double-vote prevention ───────────────────────────────────────────

    function test_CastVote_RevertOnDoubleVote() public {
        uint256 nul = _makeNullifier(0);
        voting.castVote(POC_RACE_ID, _pubSignals(nul, 1), _emptyProof());
        vm.expectRevert(abi.encodeWithSelector(VotingContract.NullifierAlreadyUsed.selector, nul));
        voting.castVote(POC_RACE_ID, _pubSignals(nul, 2), _emptyProof());
    }

    // ── public-signal validation reverts ─────────────────────────────────

    function test_CastVote_RevertInvalidMerkleRoot() public {
        uint256[5] memory s = _pubSignalsCustom(0xBADBAD, _makeNullifier(0), 1, ELECTION_ID, POC_RACE_ID);
        vm.expectRevert(
            abi.encodeWithSelector(VotingContract.InvalidMerkleRoot.selector, uint256(0xBADBAD), MERKLE_ROOT)
        );
        voting.castVote(POC_RACE_ID, s, _emptyProof());
    }

    function test_CastVote_RevertInvalidElectionId() public {
        uint256[5] memory s = _pubSignalsCustom(MERKLE_ROOT, _makeNullifier(0), 1, 99, POC_RACE_ID);
        vm.expectRevert(
            abi.encodeWithSelector(VotingContract.InvalidElectionId.selector, uint256(99), ELECTION_ID)
        );
        voting.castVote(POC_RACE_ID, s, _emptyProof());
    }

    function test_CastVote_RevertRaceIdMismatch() public {
        // raceId param = 0 but pubSignals[4] = 1 → RaceIdMismatch
        uint256[5] memory s = _pubSignalsCustom(MERKLE_ROOT, _makeNullifier(0), 1, ELECTION_ID, 1);
        vm.expectRevert(
            abi.encodeWithSelector(VotingContract.RaceIdMismatch.selector, uint256(0), uint256(1))
        );
        voting.castVote(POC_RACE_ID, s, _emptyProof());
    }

    function test_CastVote_RevertInvalidRaceIdParam() public {
        uint256[5] memory s = _pubSignalsCustom(MERKLE_ROOT, _makeNullifier(0), 1, ELECTION_ID, 1);
        vm.expectRevert(abi.encodeWithSelector(VotingContract.InvalidRaceId.selector, uint256(1)));
        voting.castVote(1, s, _emptyProof());
    }

    function test_CastVote_RevertInvalidProof() public {
        // Re-deploy with the rejecting verifier
        RejectingMockVerifier r = new RejectingMockVerifier();
        voting = new VotingContract(address(r));
        _createElection();
        _openElection();
        uint256[5] memory s = _pubSignals(_makeNullifier(0), 1);
        vm.expectRevert(VotingContract.InvalidProof.selector);
        voting.castVote(POC_RACE_ID, s, _emptyProof());
    }

    // ── state-gating ─────────────────────────────────────────────────────

    function test_CastVote_RevertWhenPending() public {
        // Re-deploy in PENDING (no openElection)
        _deploy();
        _createElection();
        uint256[5] memory s = _pubSignals(_makeNullifier(0), 1);
        vm.expectRevert(VotingContract.ElectionNotOpen.selector);
        voting.castVote(POC_RACE_ID, s, _emptyProof());
    }

    function test_CastVote_RevertWhenFinished() public {
        voting.closeElection();
        uint256[5] memory s = _pubSignals(_makeNullifier(0), 1);
        vm.expectRevert(VotingContract.ElectionNotOpen.selector);
        voting.castVote(POC_RACE_ID, s, _emptyProof());
    }

    // ── candidate id validation ──────────────────────────────────────────

    function test_CastVote_RevertOnUnknownCandidate() public {
        uint256[5] memory s = _pubSignals(_makeNullifier(0), 50);
        vm.expectRevert(abi.encodeWithSelector(VotingContract.CandidateNotFound.selector, uint256(50)));
        voting.castVote(POC_RACE_ID, s, _emptyProof());
    }

    // ── isNullifierUsed view ─────────────────────────────────────────────

    function test_IsNullifierUsed_FalseInitially() public view {
        assertFalse(voting.isNullifierUsed(POC_RACE_ID, 12345));
    }

    function test_IsNullifierUsed_RevertOnNonZeroRace() public {
        vm.expectRevert(abi.encodeWithSelector(VotingContract.InvalidRaceId.selector, uint256(1)));
        voting.isNullifierUsed(1, 12345);
    }
}
