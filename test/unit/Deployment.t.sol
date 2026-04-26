// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../helpers/BaseTest.sol";
import {VotingContract} from "../../src/VotingContract.sol";

contract DeploymentTest is BaseTest {
    function setUp() public {
        _deploy();
    }

    function test_AdminIsDeployer() public view {
        assertEq(voting.admin(), address(this));
    }

    function test_InitialStateIsPending() public view {
        assertEq(uint256(voting.state()), uint256(VotingContract.ElectionState.PENDING));
    }

    function test_VerifierIsWired() public view {
        assertEq(address(voting.verifier()), address(mockVerifier));
    }

    function test_TalliesStartAtZero() public view {
        assertEq(voting.totalVotes(), 0);
        assertEq(voting.blankVotes(), 0);
        assertEq(voting.nullVotes(), 0);
    }

    function test_NoCandidatesYet() public {
        vm.expectRevert();
        voting.candidates(0);
    }

    function test_Constants() public view {
        assertEq(voting.BLANK_VOTE(), 0);
        assertEq(voting.NULL_VOTE(), 999);
        assertEq(voting.MAX_VOTERS(), 16);
        assertEq(voting.POC_RACE_ID(), 0);
    }
}
