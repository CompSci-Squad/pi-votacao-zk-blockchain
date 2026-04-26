// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../helpers/BaseTest.sol";
import {VotingContract} from "../../src/VotingContract.sol";

contract AdminFuzzTest is BaseTest {
    function setUp() public {
        _deploy();
        voting.createElection("E", "D");
    }

    /// @notice Any length 1..MAX_VOTERS with non-zero entries must succeed.
    function testFuzz_RegisterVoterHashes_AcceptsValidLengths(uint8 lenRaw, uint256 seed) public {
        uint256 len = bound(uint256(lenRaw), 1, MAX_VOTERS);
        uint256[] memory h = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            h[i] = uint256(keccak256(abi.encode(seed, i))) | 1; // ensure non-zero
        }
        voting.registerVoterHashes(h);
        assertEq(voting.voterHashes(0), h[0]);
        assertEq(voting.voterHashes(len - 1), h[len - 1]);
    }

    /// @notice Any length > MAX_VOTERS must revert TooManyVoters.
    function testFuzz_RegisterVoterHashes_RejectsTooMany(uint16 lenRaw) public {
        uint256 len = bound(uint256(lenRaw), MAX_VOTERS + 1, 256);
        uint256[] memory h = new uint256[](len);
        for (uint256 i = 0; i < len; i++) h[i] = i + 1;
        vm.expectRevert(abi.encodeWithSelector(VotingContract.TooManyVoters.selector, len, MAX_VOTERS));
        voting.registerVoterHashes(h);
    }

    /// @notice Duplicate ballot numbers must always revert.
    function testFuzz_AddCandidate_RejectsDuplicateNumber(uint256 number) public {
        voting.addCandidate("A", "PT", number);
        vm.expectRevert(abi.encodeWithSelector(VotingContract.CandidateNumberAlreadyUsed.selector, number));
        voting.addCandidate("B", "PSD", number);
    }
}
