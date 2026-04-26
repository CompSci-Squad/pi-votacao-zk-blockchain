/**
 * test/integration/helpers/proof.js
 *
 * End-to-end proof helper used by the integration suite.
 *
 * Builds:
 *   - a Poseidon Merkle tree of voter_id leaves (depth 4, matches circuit),
 *   - the canonical nullifier_hash = Poseidon(voter_id, election_id, race_id),
 *   - a real PLONK proof via snarkjs that the contract's PlonkVerifier accepts.
 *
 * Reads ZK artifacts produced by `npm run sync:circuit`:
 *   scripts/artifacts/voter_proof.wasm
 *   scripts/artifacts/voter_proof.zkey
 *
 * NOTE — boundary contract (see .github/copilot-instructions.md, Section 2):
 *   pubSignals[0] = merkle_root
 *   pubSignals[1] = nullifier_hash
 *   pubSignals[2] = candidate_id
 *   pubSignals[3] = election_id
 *   pubSignals[4] = race_id
 * castVote ABI is castVote(uint256 raceId, uint256[5] pubSignals, uint256[24] proof).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ARTIFACTS_DIR = path.join(__dirname, "..", "..", "..", "scripts", "artifacts");
const WASM_PATH = path.join(ARTIFACTS_DIR, "voter_proof.wasm");
const ZKEY_PATH = path.join(ARTIFACTS_DIR, "voter_proof.zkey");
const VKEY_PATH = path.join(ARTIFACTS_DIR, "verification_key.json");

const TREE_DEPTH = 4; // matches voter_proof.circom

function artifactsAvailable() {
  return (
    fs.existsSync(WASM_PATH) &&
    fs.existsSync(ZKEY_PATH) &&
    fs.existsSync(VKEY_PATH)
  );
}

/**
 * Build a Poseidon Merkle tree over voter_id leaves.
 * Returns string-encoded big integers (decimal) compatible with circomlibjs.
 */
async function buildPoseidonTree(voterIds) {
  const { buildPoseidon } = require("circomlibjs");
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const SIZE = 1 << TREE_DEPTH;

  const leaves = voterIds.map((id) => poseidon([id]));
  const padded = leaves.slice();
  while (padded.length < SIZE) padded.push(F.zero);

  const tree = [padded];
  let level = padded;
  for (let d = 0; d < TREE_DEPTH; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(poseidon([level[i], level[i + 1]]));
    }
    tree.push(next);
    level = next;
  }

  const proofFor = (idx) => {
    const pathElements = [];
    const pathIndices = [];
    let cur = idx;
    for (let d = 0; d < TREE_DEPTH; d++) {
      const sib = cur % 2 === 0 ? cur + 1 : cur - 1;
      pathElements.push(F.toString(tree[d][sib]));
      pathIndices.push(cur % 2);
      cur = Math.floor(cur / 2);
    }
    return { pathElements, pathIndices };
  };

  return {
    poseidon,
    F,
    leaves: leaves.map((l) => F.toString(l)),
    root: F.toString(tree[TREE_DEPTH][0]),
    nullifierFor: (voterId, electionId, raceId) =>
      F.toString(poseidon([voterId, electionId, raceId])),
    proofFor,
  };
}

/**
 * Generate a real PLONK proof for one voter and return the calldata in the
 * shape castVote() expects.
 *
 * @param {object} args
 *   tree         — result of buildPoseidonTree()
 *   voterIndex   — leaf index in the tree
 *   voterId      — bigint, the private CPF/título value
 *   electionId   — bigint
 *   raceId       — bigint
 *   candidateId  — bigint (0 = blank, 999 = null, else candidate)
 * @returns {{ proofArr: bigint[24], pubSignals: bigint[5] }}
 */
async function generateProof({
  tree,
  voterIndex,
  voterId,
  electionId,
  raceId,
  candidateId,
}) {
  const snarkjs = require("snarkjs");
  const { pathElements, pathIndices } = tree.proofFor(voterIndex);
  const nullifierHash = tree.nullifierFor(voterId, electionId, raceId);

  const input = {
    voter_id: String(voterId),
    race_id: String(raceId),
    merkle_path: pathElements,
    merkle_path_indices: pathIndices,
    merkle_root: tree.root,
    nullifier_hash: nullifierHash,
    candidate_id: String(candidateId),
    election_id: String(electionId),
  };

  const { proof, publicSignals } = await snarkjs.plonk.fullProve(
    input,
    WASM_PATH,
    ZKEY_PATH,
  );

  // exportSolidityCallData returns "[..24..][..5..]" — splice a comma so it
  // parses as a single 2-element JSON array.
  const calldata = await snarkjs.plonk.exportSolidityCallData(proof, publicSignals);
  const parsed = JSON.parse(`[${calldata.replace("][", "],[")}]`);
  const proofArr = parsed[0].map((x) => BigInt(x));
  const pubSignals = parsed[1].map((x) => BigInt(x));

  return { proofArr, pubSignals, nullifierHash };
}

module.exports = {
  ARTIFACTS_DIR,
  WASM_PATH,
  ZKEY_PATH,
  VKEY_PATH,
  TREE_DEPTH,
  artifactsAvailable,
  buildPoseidonTree,
  generateProof,
};
