// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VotingContract} from "../../src/VotingContract.sol";
import {VotingHandler} from "./handlers/VotingHandler.sol";

contract VotingInvariantsTest is Test {
    VotingHandler internal handler;
    VotingContract internal voting;

    function setUp() public {
        handler = new VotingHandler();
        voting = handler.voting();
        targetContract(address(handler));
    }

    /// @notice totalVotes always equals the sum of all sub-tallies.
    function invariant_TalliesSumToTotal() public view {
        (
            VotingContract.Candidate[] memory cands,
            uint256 blanks,
            uint256 nulls,
            uint256 total
        ) = voting.getResults();
        uint256 sum = blanks + nulls;
        for (uint256 i = 0; i < cands.length; i++) sum += cands[i].voteCount;
        assertEq(sum, total, "tally sum != totalVotes");
    }

    // NOTE: An invariant `totalVotes <= MAX_VOTERS` would be unsound here.
    // With MockVerifier always returning true, the on-chain `castVote` does
    // not enforce voter-set membership — that property is delegated to the
    // Merkle-proof check inside the real circuit. The bound IS asserted in
    // the Phase 5 Mocha integration suite, which uses real PLONK proofs.

    /// @notice State machine is one-way: once FINISHED, never goes back.
    function invariant_StateMonotonic() public view {
        uint256 current = uint256(voting.state());
        assertGe(current, handler.ghostMaxState() == 2 ? 2 : current, "state regressed");
    }

    /// @notice Ghost counts mirror on-chain counts (handler-recorded successes only).
    function invariant_GhostMatchesOnChain() public view {
        assertEq(voting.totalVotes(), handler.ghostTotalVotes(), "total mismatch");
        assertEq(voting.blankVotes(), handler.ghostBlankVotes(), "blank mismatch");
        assertEq(voting.nullVotes(), handler.ghostNullVotes(), "null mismatch");
    }
}
