// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VotingContract} from "../src/VotingContract.sol";
import {MockVerifier} from "../test/mocks/MockVerifier.sol";

/// @title DeployLocal
/// @notice Local/anvil-only deployment that wires VotingContract to a
///         MockVerifier and brings the election to the OPEN state, ready for
///         the Mocha integration suite. Refuses to run on any chain other
///         than the default anvil chainid (31337) — the MockVerifier always
///         returns true and would be catastrophic on a real network.
///
/// Public-signal layout used by the integration suite (canonical):
///   pubSignals[0] = MERKLE_ROOT
///   pubSignals[1] = nullifier_hash
///   pubSignals[2] = candidate_id
///   pubSignals[3] = ELECTION_ID (= 1)
///   pubSignals[4] = POC_RACE_ID (= 0)
///
/// Usage:
///   forge script script/DeployLocal.s.sol:DeployLocal \
///     --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender <addr>
///
/// Or in tests / dry-run:
///   forge script script/DeployLocal.s.sol:DeployLocal --fork-url <anvil>
contract DeployLocal is Script {
    /// @dev anvil default chainid. Hardcoded — MockVerifier must never reach mainnet/testnet.
    uint256 internal constant LOCAL_CHAINID = 31337;

    /// @dev Sentinel root used by the integration suite. Real merkle root will
    ///      replace this once the off-chain merkle helper is ported (Phase 5).
    uint256 internal constant MERKLE_ROOT = 0xDEADBEEFCAFEBABE;

    function run()
        external
        returns (VotingContract voting, MockVerifier mockVerifier)
    {
        require(
            block.chainid == LOCAL_CHAINID,
            "DeployLocal: refuses to run outside anvil (chainid 31337)"
        );

        // Use anvil's first default account unless PRIVATE_KEY is provided.
        uint256 pk = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        vm.startBroadcast(pk);

        mockVerifier = new MockVerifier();
        voting = new VotingContract(address(mockVerifier));

        // ── Admin setup ─────────────────────────────────────────────────
        voting.createElection("Eleicao Local PoC", "Anvil dev fixture");
        voting.addCandidate("Alice Oliveira", "PT", 13);
        voting.addCandidate("Bruno Silva", "PSD", 45);

        uint256[] memory hashes = new uint256[](15);
        for (uint256 i = 0; i < 15; i++) {
            hashes[i] = uint256(0xAAAA0000) + (i + 1);
        }
        voting.registerVoterHashes(hashes);
        voting.setMerkleRoot(MERKLE_ROOT);
        voting.openElection();

        vm.stopBroadcast();

        console2.log("== DeployLocal - anvil dev deployment ==");
        console2.log("VotingContract:", address(voting));
        console2.log("MockVerifier:  ", address(mockVerifier));
        console2.log("Admin:         ", voting.admin());
        console2.log("ElectionId:    ", voting.currentElectionId());
        console2.log("MerkleRoot:    ", voting.voterMerkleRoot());
        console2.log("State (OPEN=1):", uint256(voting.state()));
    }
}
