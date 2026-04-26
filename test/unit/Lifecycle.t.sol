// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../helpers/BaseTest.sol";
import {VotingContract} from "../../src/VotingContract.sol";

contract LifecycleTest is BaseTest {
    function setUp() public {
        _deploy();
        _createElection();
        voting.registerVoterHashes(_voterHashes15());
        voting.setMerkleRoot(MERKLE_ROOT);
    }

    function test_OpenElection_Transitions() public {
        vm.expectEmit(false, false, false, true);
        emit VotingContract.ElectionOpened(block.timestamp, ELECTION_ID);
        voting.openElection();
        assertEq(uint256(voting.state()), uint256(VotingContract.ElectionState.OPEN));
    }

    function test_OpenElection_RevertWhenNotPending() public {
        voting.openElection();
        vm.expectRevert(VotingContract.ElectionNotPending.selector);
        voting.openElection();
    }

    function test_OpenElection_RevertWhenNonAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(VotingContract.NotAdmin.selector);
        voting.openElection();
    }

    function test_CloseElection_HappyPath() public {
        voting.openElection();
        vm.expectEmit(false, false, false, true);
        emit VotingContract.ElectionClosed(block.timestamp, 0);
        voting.closeElection();
        assertEq(uint256(voting.state()), uint256(VotingContract.ElectionState.FINISHED));
    }

    function test_CloseElection_RevertWhenStillPending() public {
        vm.expectRevert(VotingContract.ElectionNotOpen.selector);
        voting.closeElection();
    }

    function test_StateMachineIsOneWay() public {
        voting.openElection();
        voting.closeElection();
        // Cannot reopen
        vm.expectRevert(VotingContract.ElectionNotPending.selector);
        voting.openElection();
        // Cannot close twice
        vm.expectRevert(VotingContract.ElectionNotOpen.selector);
        voting.closeElection();
    }
}
