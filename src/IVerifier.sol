// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IVerifier
 * @notice Interface for the SnarkJS-generated PLONK Verifier (PlonkVerifier).
 *         Signature mirrors `snarkjs zkey export solidityverifier` output:
 *
 *           function verifyProof(
 *               uint256[24] calldata _proof,
 *               uint256[5]  calldata _pubSignals
 *           ) external view returns (bool);
 *
 * Public signals layout (canonical — referenced by all other contracts):
 *   _pubSignals[0] — merkle_root    (voter Merkle tree root)
 *   _pubSignals[1] — nullifier_hash (Poseidon(voter_id, election_id, race_id))
 *   _pubSignals[2] — candidate_id   (0 = blank, 999 = null, or sequential candidate ID)
 *   _pubSignals[3] — election_id    (unique election identifier)
 *   _pubSignals[4] — race_id        (cargo identifier — PUBLIC signal, prevents cross-race
 *                                    proof reuse by a malicious relayer)
 *
 * @dev Intentionally NOT marked `view` so that VotingContract emits a regular
 *      CALL (not STATICCALL). The real snarkjs PlonkVerifier is `view` and
 *      remains compatible (a view function can always be invoked via CALL).
 *      MockVerifier exploits this to record proofs/pubSignals for test
 *      inspection — which would be impossible under STATICCALL.
 */
interface IVerifier {
    function verifyProof(
        uint256[24] calldata _proof,
        uint256[5] calldata _pubSignals
    ) external returns (bool);
}
