/**
 * console_helpers.js — copy/paste recipes for `hardhat console --network localhost`.
 *
 * This file is NOT executed automatically. It exists so that during a live demo
 * you can open it side-by-side with the console and paste the snippets.
 *
 * Prerequisite: docker compose up -d  &&  npx hardhat --network localhost run scripts/demo.js
 * (The demo uses deterministic mnemonic, so the addresses below are stable
 * across runs as long as the chain was reset before deploy.)
 */

// =============================================================================
// 0. Open the console
// =============================================================================
// $ npx hardhat console --network localhost

// =============================================================================
// 1. Attach to the deployed contracts
// =============================================================================
// (Addresses match what scripts/demo.js prints. They are deterministic given
//  the default Hardhat mnemonic + a fresh chain.)
//
// const VERIFIER = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
// const VOTING   = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
// const v = await ethers.getContractAt("VotingContract", VOTING);

// =============================================================================
// 2. Inspect election + race state
// =============================================================================
// await v.electionState();                       // 0=PENDING, 1=OPEN, 2=FINISHED
// await v.voterMerkleRoot();                     // bigint, should match demo's printed root
// await v.getResults();                          // [candidates[], blank, null, total]
// await v.getRaceResults(0n);                    // same shape, race-scoped (POC_RACE_ID = 0)

// =============================================================================
// 3. Inspect nullifier usage
// =============================================================================
// const RACE_ID = 0n;
// const nullifier = "0x..."; // copy from demo output (pubSignals[1])
// await v.isNullifierUsed(RACE_ID, nullifier);   // true after a successful castVote

// =============================================================================
// 4. Replay the VoteCast events from the chain
// =============================================================================
// const filter = v.filters.VoteCast();
// const events = await v.queryFilter(filter, 0, "latest");
// for (const e of events) {
//   console.log({
//     block:      e.blockNumber,
//     tx:         e.transactionHash,
//     nullifier:  e.args.nullifier.toString(),
//     raceId:     e.args.raceId.toString(),
//     candidate:  e.args.candidateId.toString(),
//   });
// }

// =============================================================================
// 5. Raw chain inspection (no contract knowledge needed)
// =============================================================================
// await ethers.provider.getBlockNumber();
// await ethers.provider.getBlock("latest");
// await ethers.provider.getTransactionReceipt("0x147d4db5...");  // tx hash from demo
