// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../helpers/BaseTest.sol";
import {VotingContract} from "../../src/VotingContract.sol";

contract AdminSetupTest is BaseTest {
    function setUp() public {
        _deploy();
    }

    // ── createElection ───────────────────────────────────────────────────

    function test_CreateElection_HappyPath() public {
        vm.expectEmit(false, false, false, true);
        emit VotingContract.ElectionCreated("E", 1);
        voting.createElection("E", "D");
        assertEq(voting.currentElectionId(), 1);
        assertEq(voting.electionName(), "E");
    }

    function test_CreateElection_RevertWhenNonAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(VotingContract.NotAdmin.selector);
        voting.createElection("E", "D");
    }

    function test_CreateElection_RevertOnDuplicate() public {
        voting.createElection("E", "D");
        vm.expectRevert(VotingContract.ElectionAlreadyExists.selector);
        voting.createElection("E2", "D2");
    }

    // ── addCandidate ─────────────────────────────────────────────────────

    function test_AddCandidate_AssignsSequentialIds() public {
        voting.createElection("E", "D");
        voting.addCandidate("A", "PT", 13);
        voting.addCandidate("B", "PSD", 45);
        (uint256 idA,,,, ) = voting.candidates(0);
        (uint256 idB,,,, ) = voting.candidates(1);
        assertEq(idA, 1);
        assertEq(idB, 2);
    }

    function test_AddCandidate_EmitsEvent() public {
        voting.createElection("E", "D");
        vm.expectEmit(true, false, false, true);
        emit VotingContract.CandidateAdded(1, "A", 13);
        voting.addCandidate("A", "PT", 13);
    }

    function test_AddCandidate_RevertOnDuplicateNumber() public {
        voting.createElection("E", "D");
        voting.addCandidate("A", "PT", 13);
        vm.expectRevert(abi.encodeWithSelector(VotingContract.CandidateNumberAlreadyUsed.selector, uint256(13)));
        voting.addCandidate("B", "PSD", 13);
    }

    function test_AddCandidate_RevertWhenNonAdmin() public {
        voting.createElection("E", "D");
        vm.prank(stranger);
        vm.expectRevert(VotingContract.NotAdmin.selector);
        voting.addCandidate("A", "PT", 13);
    }

    // ── registerVoterHashes ──────────────────────────────────────────────

    function test_RegisterVoterHashes_HappyPath() public {
        voting.createElection("E", "D");
        uint256[] memory h = _voterHashes15();
        voting.registerVoterHashes(h);
        assertEq(voting.voterHashes(0), h[0]);
        assertEq(voting.voterHashes(14), h[14]);
    }

    function test_RegisterVoterHashes_RevertOnSecondCall() public {
        voting.createElection("E", "D");
        voting.registerVoterHashes(_voterHashes15());
        vm.expectRevert(VotingContract.VoterHashesAlreadyRegistered.selector);
        voting.registerVoterHashes(_voterHashes15());
    }

    function test_RegisterVoterHashes_RevertWhenTooMany() public {
        voting.createElection("E", "D");
        uint256[] memory h = new uint256[](17);
        for (uint256 i = 0; i < 17; i++) h[i] = i + 1;
        vm.expectRevert(abi.encodeWithSelector(VotingContract.TooManyVoters.selector, uint256(17), uint256(16)));
        voting.registerVoterHashes(h);
    }

    function test_RegisterVoterHashes_RevertOnZeroHash() public {
        voting.createElection("E", "D");
        uint256[] memory h = new uint256[](3);
        h[0] = 1;
        h[1] = 0; // invalid
        h[2] = 3;
        vm.expectRevert(abi.encodeWithSelector(VotingContract.InvalidVoterHash.selector, uint256(1)));
        voting.registerVoterHashes(h);
    }

    function test_RegisterVoterHashes_RevertWhenNonAdmin() public {
        voting.createElection("E", "D");
        vm.prank(stranger);
        vm.expectRevert(VotingContract.NotAdmin.selector);
        voting.registerVoterHashes(_voterHashes15());
    }

    // ── setMerkleRoot ────────────────────────────────────────────────────

    function test_SetMerkleRoot_HappyPath() public {
        voting.createElection("E", "D");
        voting.registerVoterHashes(_voterHashes15());
        vm.expectEmit(false, false, false, true);
        emit VotingContract.MerkleRootSet(MERKLE_ROOT);
        voting.setMerkleRoot(MERKLE_ROOT);
        assertEq(voting.voterMerkleRoot(), MERKLE_ROOT);
    }

    function test_SetMerkleRoot_RevertWhenNoHashes() public {
        voting.createElection("E", "D");
        vm.expectRevert(VotingContract.NoVoterHashesRegistered.selector);
        voting.setMerkleRoot(MERKLE_ROOT);
    }

    function test_SetMerkleRoot_RevertWhenNonAdmin() public {
        voting.createElection("E", "D");
        voting.registerVoterHashes(_voterHashes15());
        vm.prank(stranger);
        vm.expectRevert(VotingContract.NotAdmin.selector);
        voting.setMerkleRoot(MERKLE_ROOT);
    }
}
