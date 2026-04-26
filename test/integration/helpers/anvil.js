/**
 * test/integration/helpers/anvil.js
 *
 * Harness for the Mocha integration suite. Expects an `anvil` JSON-RPC
 * server reachable at ANVIL_RPC_URL — usually the docker-compose `anvil`
 * service. Bring it up with `docker compose up -d anvil` from the repo root.
 *
 * Snapshot/revert use anvil's evm_snapshot / evm_revert.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "out");

const ANVIL_RPC_URL = process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
const ANVIL_CHAIN_ID = 31337;

const DEFAULT_PRIVATE_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
];

async function ensureAnvilReachable() {
  const provider = new ethers.JsonRpcProvider(ANVIL_RPC_URL);
  try {
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== ANVIL_CHAIN_ID) {
      throw new Error(
        `anvil chainId mismatch: expected ${ANVIL_CHAIN_ID}, got ${net.chainId}`
      );
    }
  } catch (err) {
    throw new Error(
      `anvil not reachable at ${ANVIL_RPC_URL}. ` +
        "Start it with: `docker compose up -d anvil` from the repo root.\n" +
        `Underlying error: ${err.message}`
    );
  }
}

function loadArtifact(contractFile, contractName) {
  const p = path.join(OUT_DIR, contractFile, `${contractName}.json`);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

function getProvider() {
  // Disable RPC batching so sequential awaits see fresh state.
  // Without this, ethers v6 batches calls within a tick - meaning a
  // post-deploy `getTransactionCount` can resolve against pre-deploy
  // state and return a stale nonce, causing "nonce too low" errors.
  return new ethers.JsonRpcProvider(ANVIL_RPC_URL, undefined, {
    batchMaxCount: 1,
  });
}

function getWallets(provider) {
  return DEFAULT_PRIVATE_KEYS.map((k) => new ethers.Wallet(k, provider));
}

async function snapshot(provider) {
  return provider.send("evm_snapshot", []);
}

async function revert(provider, id) {
  await provider.send("evm_revert", [id]);
}

async function resetAnvil(provider) {
  await provider.send("anvil_reset", []);
}

module.exports = {
  ANVIL_RPC_URL,
  ANVIL_CHAIN_ID,
  ensureAnvilReachable,
  resetAnvil,
  loadArtifact,
  getProvider,
  getWallets,
  snapshot,
  revert,
};
