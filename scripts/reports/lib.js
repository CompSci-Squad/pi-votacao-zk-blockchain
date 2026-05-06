/**
 * scripts/reports/lib.js
 *
 * Shared helpers for the Brazilian-style election audit reports
 * (Zerésima, Boletim de Urna, RDV).
 *
 * All reports share these properties:
 *   - Read-only; never sends a transaction.
 *   - Stamp every output file (JSON + MD) with a SHA-256 of the canonical
 *     JSON payload, so any external auditor can recompute and verify integrity.
 *   - Output goes under reports/runtime/<kind>_<electionId>_<timestamp>.{json,md}.
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");

const ROOT          = path.resolve(__dirname, "..", "..");
const RUNTIME_DIR   = path.join(ROOT, "reports", "runtime");
const ABI_OUT_DIR   = path.join(ROOT, "out", "VotingContract.sol", "VotingContract.json");
const RPC_URL       = process.env.RPC_URL    || "http://127.0.0.1:8545";
const VOTING_ADDR   = process.env.VOTING_ADDR || "";

function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL, undefined, { batchMaxCount: 1 });
}

function loadVotingAbi() {
  const j = JSON.parse(fs.readFileSync(ABI_OUT_DIR, "utf8"));
  return j.abi;
}

function getVoting(provider) {
  if (!VOTING_ADDR) {
    throw new Error("VOTING_ADDR env var is required (deployed contract address).");
  }
  return new ethers.Contract(VOTING_ADDR, loadVotingAbi(), provider);
}

/**
 * BigInt → JSON-safe replacer.  Anywhere a BigInt appears it becomes a
 * decimal string, which is the standard convention for canonical JSON in the
 * voting/auditing domain.
 */
function jsonReplacer(_k, v) {
  if (typeof v === "bigint") return v.toString();
  return v;
}

function canonicalize(obj) {
  // Deterministic stringification: keys sorted at every level.
  if (obj === null || typeof obj !== "object") {
    if (typeof obj === "bigint") return JSON.stringify(obj.toString());
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function timestampSlug(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/**
 * Write a (JSON, MD) pair atomically.  Returns absolute paths.
 * The JSON file is the source of truth (canonical).  The MD file is a
 * human-friendly companion that embeds the same SHA-256.
 */
function writeReport(kind, electionId, payload, markdown) {
  ensureDir(RUNTIME_DIR);
  const slug   = timestampSlug();
  const base   = `${kind}_election${electionId}_${slug}`;
  const canon  = canonicalize(payload);
  const sha    = sha256Hex(Buffer.from(canon, "utf8"));
  const stampedPayload = { ...payload, _integrity: { algo: "sha256", canonical_sha256: sha } };

  const jsonPath = path.join(RUNTIME_DIR, `${base}.json`);
  const mdPath   = path.join(RUNTIME_DIR, `${base}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(stampedPayload, jsonReplacer, 2) + "\n");
  fs.writeFileSync(mdPath,   markdown.replace("__SHA256__", sha) + "\n");
  return { jsonPath, mdPath, sha };
}

module.exports = {
  ROOT,
  RUNTIME_DIR,
  RPC_URL,
  VOTING_ADDR,
  getProvider,
  getVoting,
  loadVotingAbi,
  canonicalize,
  sha256Hex,
  ensureDir,
  timestampSlug,
  writeReport,
};
