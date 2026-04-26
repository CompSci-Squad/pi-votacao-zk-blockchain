// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../helpers/BaseTest.sol";
import {VotingContract} from "../../src/VotingContract.sol";

contract ZeresimaTest is BaseTest {
    function setUp() public {
        _setUpPending();
    }

    function test_Zeresima_AllZeroBeforeAnyVote() public view {
        (
            string memory name,
            VotingContract.Candidate[] memory cands,
            uint256 voterCount,
            bool allZero,
            uint256 ts,
            uint256 bn
        ) = voting.getZeresima();
        assertEq(name, "Eleicao Teste PoC");
        assertEq(cands.length, 2);
        assertEq(voterCount, 0); // hashes not registered yet in this fixture
        assertTrue(allZero);
        assertEq(ts, block.timestamp);
        assertEq(bn, block.number);
    }

    function test_Zeresima_RevertOnceOpen() public {
        voting.registerVoterHashes(_voterHashes15());
        voting.setMerkleRoot(MERKLE_ROOT);
        voting.openElection();
        vm.expectRevert(VotingContract.ElectionNotPending.selector);
        voting.getZeresima();
    }

    function test_Zeresima_RevertOnceFinished() public {
        voting.registerVoterHashes(_voterHashes15());
        voting.setMerkleRoot(MERKLE_ROOT);
        voting.openElection();
        voting.closeElection();
        vm.expectRevert(VotingContract.ElectionNotPending.selector);
        voting.getZeresima();
    }
}
