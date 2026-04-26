// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title MockVerifier
 * @notice Test-only PLONK verifier. Always returns true so that unit tests can
 *         exercise VotingContract without a real ZK backend.
 *
 *         Mirrors the snarkjs-generated PlonkVerifier ABI exactly:
 *           verifyProof(uint256[24] calldata, uint256[5] calldata)
 *
 *         Stores the last submitted proof and pubSignals for inspection via
 *         getLastProof(i) / getLastPubSignal(i), enabling tests to assert the
 *         exact order of pubSignals[0..4] passed by castVote().
 *
 *         NEVER deploy this on a public network.
 */
contract MockVerifier {
    /// @dev Last proof submitted to verifyProof (24 field elements)
    uint256[24] private _lastProof;
    /// @dev Last pubSignals submitted to verifyProof (5 field elements)
    uint256[5]  private _lastPubSignals;
    /// @dev Set true on the first call — useful for asserting the verifier was hit
    bool public called;

    /**
     * @notice Verify a PLONK proof — always returns true in test environment.
     * @dev Marked `view` to satisfy IVerifier; Solidity does not actually
     *      enforce purity at the EVM level, so the SSTOREs below succeed when
     *      called from a non-staticcall context (which VotingContract uses).
     *
     *      NOTE: `view` is a compile-time annotation only. We deliberately
     *      keep the function non-view here to record state for tests; the
     *      interface in IVerifier.sol is `view` because that's what the real
     *      snarkjs verifier emits, and a non-view implementation still
     *      satisfies it for CALL-based invocations.
     */
    function verifyProof(
        uint256[24] calldata _proof,
        uint256[5]  calldata _pubSignals
    ) external returns (bool) {
        for (uint256 i = 0; i < 24; i++) {
            _lastProof[i] = _proof[i];
        }
        for (uint256 i = 0; i < 5; i++) {
            _lastPubSignals[i] = _pubSignals[i];
        }
        called = true;
        return true;
    }

    /**
     * @notice Return the i-th element of the last submitted pubSignals.
     * @param i Index 0–4.
     */
    function getLastPubSignal(uint256 i) external view returns (uint256) {
        require(i < 5, "MockVerifier: indice fora do intervalo");
        return _lastPubSignals[i];
    }

    /**
     * @notice Return the i-th element of the last submitted proof.
     * @param i Index 0–23.
     */
    function getLastProofElement(uint256 i) external view returns (uint256) {
        require(i < 24, "MockVerifier: indice fora do intervalo");
        return _lastProof[i];
    }
}
