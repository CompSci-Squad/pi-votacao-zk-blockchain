// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockVerifier
 * @notice Test-only PLONK verifier. Always returns true so that unit tests can
 *         exercise VotingContract without a real ZK backend.
 *
 *         Stores the last submitted proof and pubSignals for inspection via
 *         getLastPubSignal(i), enabling tests to assert the exact order of
 *         pubSignals[0..4] passed by castVote().
 *
 *         NEVER deploy this on a public network.
 */
contract MockVerifier {
    /// @dev Last raw proof bytes submitted to verifyProof (stored for test assertions)
    bytes public lastProof;
    /// @dev Last pubSignals array submitted to verifyProof (stored for test assertions)
    uint256[] public lastPubSignals;

    /**
     * @notice Verify a PLONK proof — always returns true in test environment.
     * @param _proof      PLONK proof bytes (ignored; stored for inspection)
     * @param _pubSignals Public signals — must contain exactly 5 elements:
     *                    [merkle_root, nullifier_hash, candidate_id, election_id, race_id]
     */
    function verifyProof(
        bytes memory _proof,
        uint256[] memory _pubSignals
    ) external returns (bool) {
        require(
            _pubSignals.length == 5,
            "MockVerifier: esperados 5 sinais publicos"
        );
        lastProof = _proof;
        lastPubSignals = _pubSignals;
        return true;
    }

    /**
     * @notice Return the i-th element of the last submitted pubSignals array.
     * @dev Convenience helper for Python tests:
     *      mock_verifier.getLastPubSignal(0) == merkle_root
     *      mock_verifier.getLastPubSignal(1) == nullifier_hash
     *      mock_verifier.getLastPubSignal(2) == candidate_id
     *      mock_verifier.getLastPubSignal(3) == election_id
     *      mock_verifier.getLastPubSignal(4) == race_id
     * @param i Index into lastPubSignals (0–4).
     * @return Value at position i.
     */
    function getLastPubSignal(uint256 i) external view returns (uint256) {
        require(i < lastPubSignals.length, "MockVerifier: indice fora do intervalo");
        return lastPubSignals[i];
    }
}
