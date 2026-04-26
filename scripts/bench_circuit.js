#!/usr/bin/env node
/**
 * scripts/bench_circuit.js
 *
 * Captures circuit-side benchmarks for the article appendix:
 *   - r1cs info (constraints, wires, public/private signal counts)
 *   - PLONK proof generation wall-clock (median of N runs)
 *   - PLONK proof verification wall-clock
 *   - Artifact sizes
 *
 * Output: bench-circuit.txt (machine-readable + human-readable).
 *
 * Usage:
 *   npm run bench:circuit            # 5 proof runs (default)
 *   BENCH_RUNS=10 npm run bench:circuit
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const RUNS = Number(process.env.BENCH_RUNS || 5);

const ARTIFACTS_DIR = path.join(__dirname, "artifacts");
const WASM = path.join(ARTIFACTS_DIR, "voter_proof.wasm");
const ZKEY = path.join(ARTIFACTS_DIR, "voter_proof.zkey");
const VKEY = path.join(ARTIFACTS_DIR, "verification_key.json");
const CIRCUITS_REPO = path.resolve(__dirname, "..", "..", "pi-votacao-zk-circuits");
const R1CS = path.join(CIRCUITS_REPO, "build", "voter_proof.r1cs");
const OUT = path.join(__dirname, "..", "bench-circuit.txt");

function size(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  for (const f of [WASM, ZKEY, VKEY]) {
    if (!fs.existsSync(f)) {
      console.error(`✗ Missing artifact: ${f}`);
      console.error("  Run: npm run sync:circuit");
      process.exit(1);
    }
  }

  const snarkjs = require("snarkjs");
  const { buildPoseidon } = require("circomlibjs");

  console.log(`→ Bench config: ${RUNS} proof runs`);
  console.log("");

  // r1cs info — read the binary header directly via snarkjs
  let r1csInfo = null;
  let r1csSummary = null;
  if (fs.existsSync(R1CS)) {
    const raw = await snarkjs.r1cs.info(R1CS);
    // Strip the curve object (contains huge BigInt buffers that blow JSON.stringify).
    r1csSummary = {
      nConstraints: raw.nConstraints,
      nVars: raw.nVars,
      nPubInputs: raw.nPubInputs,
      nOutputs: raw.nOutputs,
      nPrvInputs: raw.nPrvInputs,
      nLabels: raw.nLabels,
      curve: raw.curve && raw.curve.name ? raw.curve.name : "unknown",
    };
    r1csInfo = r1csSummary;
    console.log("R1CS:");
    console.log(`  constraints      = ${r1csSummary.nConstraints}`);
    console.log(`  variables (wires)= ${r1csSummary.nVars}`);
    console.log(`  public inputs    = ${r1csSummary.nPubInputs}`);
    console.log(`  public outputs   = ${r1csSummary.nOutputs}`);
    console.log(`  private inputs   = ${r1csSummary.nPrvInputs}`);
    console.log(`  labels           = ${r1csSummary.nLabels}`);
    console.log(`  curve            = ${r1csSummary.curve}`);
  } else {
    console.log("R1CS: (not found at " + R1CS + ", skipping r1cs info)");
  }
  console.log("");

  // Build a real witness input (one voter, depth-4 Merkle tree).
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const TREE_DEPTH = 4;
  const SIZE = 1 << TREE_DEPTH;
  const voterId = 12345678901n;
  const electionId = 1n;
  const raceId = 0n;
  const candidateId = 1n;
  const leaves = [poseidon([voterId])];
  while (leaves.length < SIZE) leaves.push(F.zero);
  const tree = [leaves];
  let level = leaves;
  for (let d = 0; d < TREE_DEPTH; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(poseidon([level[i], level[i + 1]]));
    }
    tree.push(next);
    level = next;
  }
  const pathElements = [];
  const pathIndices = [];
  let cur = 0;
  for (let d = 0; d < TREE_DEPTH; d++) {
    const sib = cur % 2 === 0 ? cur + 1 : cur - 1;
    pathElements.push(F.toString(tree[d][sib]));
    pathIndices.push(cur % 2);
    cur = Math.floor(cur / 2);
  }
  const nullifierHash = F.toString(poseidon([voterId, electionId, raceId]));
  const root = F.toString(tree[TREE_DEPTH][0]);
  const input = {
    voter_id: String(voterId),
    race_id: String(raceId),
    merkle_path: pathElements,
    merkle_path_indices: pathIndices,
    merkle_root: root,
    nullifier_hash: nullifierHash,
    candidate_id: String(candidateId),
    election_id: String(electionId),
  };

  const vKey = JSON.parse(fs.readFileSync(VKEY, "utf8"));

  // Warm-up
  await snarkjs.plonk.fullProve(input, WASM, ZKEY);

  const proveTimes = [];
  const verifyTimes = [];
  let lastProof, lastSignals;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const { proof, publicSignals } = await snarkjs.plonk.fullProve(input, WASM, ZKEY);
    const t1 = performance.now();
    const ok = await snarkjs.plonk.verify(vKey, publicSignals, proof);
    const t2 = performance.now();
    if (!ok) throw new Error("PLONK verify returned false during bench");
    proveTimes.push(t1 - t0);
    verifyTimes.push(t2 - t1);
    lastProof = proof;
    lastSignals = publicSignals;
    process.stdout.write(`  run ${i + 1}/${RUNS}  prove=${(t1 - t0).toFixed(0)}ms  verify=${(t2 - t1).toFixed(0)}ms\n`);
  }

  const proofBytes = Buffer.byteLength(JSON.stringify(lastProof));
  const sizes = {
    wasm: size(WASM),
    zkey: size(ZKEY),
    vkey: size(VKEY),
    r1cs: size(R1CS),
    proof_json: proofBytes,
  };

  console.log("");
  console.log("Proof generation (snarkjs.plonk.fullProve):");
  console.log(`  median = ${median(proveTimes).toFixed(1)} ms`);
  console.log(`  min    = ${Math.min(...proveTimes).toFixed(1)} ms`);
  console.log(`  max    = ${Math.max(...proveTimes).toFixed(1)} ms`);
  console.log("");
  console.log("Off-chain verification (snarkjs.plonk.verify):");
  console.log(`  median = ${median(verifyTimes).toFixed(1)} ms`);
  console.log("");
  console.log("Artifact sizes:");
  for (const [k, v] of Object.entries(sizes)) {
    console.log(`  ${k.padEnd(11)} = ${v} bytes`);
  }

  // Persist
  const out = {
    timestamp: new Date().toISOString(),
    runs: RUNS,
    r1cs: r1csInfo,
    prove_ms: { median: median(proveTimes), min: Math.min(...proveTimes), max: Math.max(...proveTimes), all: proveTimes },
    verify_ms: { median: median(verifyTimes), min: Math.min(...verifyTimes), max: Math.max(...verifyTimes), all: verifyTimes },
    sizes,
    pubSignals_count: lastSignals.length,
  };
  // r1csInfo contains a BigInt-like curve object; sanitize for JSON.
  const safe = JSON.parse(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  fs.writeFileSync(OUT, JSON.stringify(safe, null, 2));
  console.log(`\n✓ Wrote ${OUT}`);

  // snarkjs leaves a process listener around; force exit.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
