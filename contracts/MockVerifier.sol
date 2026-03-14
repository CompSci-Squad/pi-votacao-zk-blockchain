// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockVerifier
 * @notice Test-only verifier. Returns true for all proofs so that unit
 *         tests can exercise VotingContract without a real ZK backend.
 *         NEVER deploy this on a public network.
 */
contract MockVerifier {
    function verifyProof(
        uint[2] calldata,
        uint[2][2] calldata,
        uint[2] calldata,
        uint[2] calldata
    ) external pure returns (bool) {
        return true;
    }
}
