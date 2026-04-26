// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {VotingContract} from "../../src/VotingContract.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";
import {RejectingMockVerifier} from "../mocks/RejectingMockVerifier.sol";

/// @notice Shared test scaffolding. Mirrors the JS fixtures.js semantics:
///   - 15 voters in a depth-4 Merkle tree (max 16 leaves)
///   - sentinel MERKLE_ROOT
///   - electionId == 1 (assigned by createElection)
///   - canonical pubSignals layout [merkleRoot, nullifier, candidateId, electionId, raceId]
abstract contract BaseTest is Test {
    VotingContract internal voting;
    MockVerifier internal mockVerifier;

    address internal admin = address(this);
    address internal stranger = address(0xBEEF);

    uint256 internal constant POC_RACE_ID = 0;
    uint256 internal constant ELECTION_ID = 1;
    uint256 internal constant BLANK_VOTE = 0;
    uint256 internal constant NULL_VOTE = 999;
    uint256 internal constant MERKLE_ROOT = 0xDEADBEEFCAFEBABE;
    uint256 internal constant MAX_VOTERS = 16;

    string internal constant CAND_A_NAME = "Alice Oliveira";
    string internal constant CAND_A_PARTY = "PT";
    uint256 internal constant CAND_A_NUMBER = 13;

    string internal constant CAND_B_NAME = "Bruno Silva";
    string internal constant CAND_B_PARTY = "PSD";
    uint256 internal constant CAND_B_NUMBER = 45;

    function _voterHashes15() internal pure returns (uint256[] memory hashes) {
        hashes = new uint256[](15);
        for (uint256 i = 0; i < 15; i++) {
            hashes[i] = uint256(0xAAAA0000) + (i + 1);
        }
    }

    function _emptyProof() internal pure returns (uint256[24] memory p) {
        // all zeros; MockVerifier ignores content
    }

    /// @dev Build canonical pubSignals tuple. Defaults match the open-election fixture.
    function _pubSignals(uint256 nullifier, uint256 candidateId)
        internal
        pure
        returns (uint256[5] memory s)
    {
        s[0] = MERKLE_ROOT;
        s[1] = nullifier;
        s[2] = candidateId;
        s[3] = ELECTION_ID;
        s[4] = POC_RACE_ID;
    }

    function _pubSignalsCustom(
        uint256 merkleRoot,
        uint256 nullifier,
        uint256 candidateId,
        uint256 electionId,
        uint256 raceId
    ) internal pure returns (uint256[5] memory s) {
        s[0] = merkleRoot;
        s[1] = nullifier;
        s[2] = candidateId;
        s[3] = electionId;
        s[4] = raceId;
    }

    /// @dev Deterministic non-zero unique nullifier per voter index (mirrors makeNullifier).
    function _makeNullifier(uint256 voterIndex) internal pure returns (uint256) {
        return (voterIndex + 1) * 1e18 + ELECTION_ID * 1e9 + POC_RACE_ID + 1;
    }

    // ────── deployment helpers ──────────────────────────────────────────

    function _deploy() internal {
        mockVerifier = new MockVerifier();
        voting = new VotingContract(address(mockVerifier));
    }

    function _deployWithRejecting() internal returns (RejectingMockVerifier r) {
        r = new RejectingMockVerifier();
        voting = new VotingContract(address(r));
    }

    function _createElection() internal {
        voting.createElection("Eleicao Teste PoC", "Prova de Conceito - IMT");
        voting.addCandidate(CAND_A_NAME, CAND_A_PARTY, CAND_A_NUMBER);
        voting.addCandidate(CAND_B_NAME, CAND_B_PARTY, CAND_B_NUMBER);
    }

    function _openElection() internal {
        voting.registerVoterHashes(_voterHashes15());
        voting.setMerkleRoot(MERKLE_ROOT);
        voting.openElection();
    }

    function _setUpOpen() internal {
        _deploy();
        _createElection();
        _openElection();
    }

    function _setUpPending() internal {
        _deploy();
        _createElection();
    }
}
