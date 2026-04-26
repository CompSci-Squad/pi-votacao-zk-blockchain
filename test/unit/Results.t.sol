// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../helpers/BaseTest.sol";
import {VotingContract} from "../../src/VotingContract.sol";

contract ResultsTest is BaseTest {
    function setUp() public {
        _setUpOpen();
    }

    function _vote(uint256 voterIdx, uint256 candidateId) internal {
        voting.castVote(
            POC_RACE_ID,
            _pubSignals(_makeNullifier(voterIdx), candidateId),
            _emptyProof()
        );
    }

    function test_Results_TalliesAcrossAllVoteTypes() public {
        // 3 for candidate 1, 2 for candidate 2, 1 blank, 2 null
        _vote(0, 1);
        _vote(1, 1);
        _vote(2, 1);
        _vote(3, 2);
        _vote(4, 2);
        _vote(5, BLANK_VOTE);
        _vote(6, NULL_VOTE);
        _vote(7, NULL_VOTE);

        (
            VotingContract.Candidate[] memory cands,
            uint256 blanks,
            uint256 nulls,
            uint256 total
        ) = voting.getResults();

        assertEq(cands.length, 2);
        assertEq(cands[0].voteCount, 3);
        assertEq(cands[1].voteCount, 2);
        assertEq(blanks, 1);
        assertEq(nulls, 2);
        assertEq(total, 8);
    }

    function test_GetRaceResults_RevertOnNonZeroRace() public {
        vm.expectRevert(abi.encodeWithSelector(VotingContract.InvalidRaceId.selector, uint256(1)));
        voting.getRaceResults(1);
    }

    function test_GetRaceResults_MatchesGetResults() public {
        _vote(0, 1);
        _vote(1, BLANK_VOTE);
        (VotingContract.Candidate[] memory c1, uint256 b1, uint256 n1, uint256 t1) = voting.getResults();
        (VotingContract.Candidate[] memory c2, uint256 b2, uint256 n2, uint256 t2) = voting.getRaceResults(0);
        assertEq(c1.length, c2.length);
        assertEq(b1, b2);
        assertEq(n1, n2);
        assertEq(t1, t2);
    }

    function test_GetCandidates_ReturnsAll() public view {
        VotingContract.Candidate[] memory c = voting.getCandidates();
        assertEq(c.length, 2);
        assertEq(c[0].name, CAND_A_NAME);
        assertEq(c[1].name, CAND_B_NAME);
    }

    function test_GetCandidatesByRace_RevertOnNonZeroRace() public {
        vm.expectRevert(abi.encodeWithSelector(VotingContract.InvalidRaceId.selector, uint256(2)));
        voting.getCandidatesByRace(2);
    }

    function test_GetCandidateCount() public view {
        assertEq(voting.getCandidateCount(), 2);
    }

    function test_GetVoterHashes() public view {
        uint256[] memory h = voting.getVoterHashes();
        assertEq(h.length, 15);
    }
}
