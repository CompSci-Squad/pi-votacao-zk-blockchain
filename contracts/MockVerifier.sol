// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockVerifier
 * @notice Test-only PLONK verifier. Returns true for all proofs so that unit
 *         tests can exercise VotingContract without a real ZK backend.
 *         NEVER deploy this on a public network.
 */
contract MockVerifier {
    function verifyProof(
        bytes memory,    /* _proof (ignored) */
        uint256[] memory /* _pubSignals (ignored) */
    ) external pure returns (bool) {
        return true;
    }
}
