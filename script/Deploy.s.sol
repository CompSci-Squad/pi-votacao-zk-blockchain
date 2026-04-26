// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VotingContract} from "../src/VotingContract.sol";

/// @title Deploy
/// @notice Production deployment of VotingContract.
///         Expects the real SnarkJS-generated PlonkVerifier to be deployed
///         separately (its address is provided via the VERIFIER_ADDRESS env
///         var). Admin setup (createElection, registerVoterHashes,
///         setMerkleRoot, openElection) is intentionally NOT performed here
///         — it is an operational step run by the election authority through
///         a separate transaction once the candidate list and voter set are
///         finalised.
///
/// Usage:
///   VERIFIER_ADDRESS=0x... \
///   PRIVATE_KEY=0x...      \
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $RPC_URL --broadcast
contract Deploy is Script {
    function run() external returns (VotingContract voting) {
        address verifierAddr = vm.envAddress("VERIFIER_ADDRESS");
        require(verifierAddr != address(0), "Deploy: VERIFIER_ADDRESS not set");

        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        voting = new VotingContract(verifierAddr);
        vm.stopBroadcast();

        console2.log("VotingContract:", address(voting));
        console2.log("Verifier:      ", verifierAddr);
        console2.log("Admin:         ", voting.admin());
    }
}
