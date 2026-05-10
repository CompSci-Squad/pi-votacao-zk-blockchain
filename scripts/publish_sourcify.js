/**
 * scripts/publish_sourcify.js
 *
 * Populates the local Sourcify-V1 repo (served by the `sourcify-repo`
 * docker compose service at http://localhost:5102) with the metadata +
 * sources of a freshly deployed contract. Otterscan, configured via
 * viz/otterscan-config.json, then fetches them and renders the contract
 * with decoded function names, parameter names, and event signatures.
 *
 * Usage (programmatic):
 *   const { publishContract, resetRepo } = require("./publish_sourcify");
 *   resetRepo();
 *   await publishContract({
 *     address: "0xe7f1...0512",
 *     chainId: 31337,
 *     artifactRel: "VotingContract.sol/VotingContract.json",
 *   });
 *
 * Repo layout (V1):
 *   <repoRoot>/contracts/full_match/<chainId>/<checksumAddress>/
 *     metadata.json
 *     sources/<original_source_path>
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const REPO_ROOT = path.join(__dirname, "..");                    // pi-votacao-zk-blockchain/
const PROJECT_ROOT = path.join(REPO_ROOT, "..");                 // pi_votacao/
const FOUNDRY_OUT = path.join(REPO_ROOT, "out");
const SOURCIFY_REPO = path.join(PROJECT_ROOT, "viz", "sourcify-repo");

function resetRepo() {
  const target = path.join(SOURCIFY_REPO, "contracts");
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(target, { recursive: true });
}

function readArtifact(artifactRel) {
  const p = path.join(FOUNDRY_OUT, artifactRel);
  if (!fs.existsSync(p)) {
    throw new Error(`Foundry artifact not found: ${p} (run \`forge build\`)`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function resolveSourcePath(relPath) {
  // Try the contract repo first, then the project root (for any future
  // cross-repo includes — none today, but cheap to keep).
  const candidates = [
    path.join(REPO_ROOT, relPath),
    path.join(PROJECT_ROOT, relPath),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`Source not found on disk: ${relPath} (looked in ${candidates.join(", ")})`);
}

/**
 * Publish one contract to the local Sourcify repo.
 *
 * @param {{ address: string, chainId: number, artifactRel: string }} args
 *   - address: deployed address (any case; will be EIP-55 checksummed)
 *   - chainId: target chain id (31337 for our anvil)
 *   - artifactRel: path under `out/` to the Foundry artifact, e.g.
 *                  "VotingContract.sol/VotingContract.json"
 */
async function publishContract({ address, chainId, artifactRel }) {
  const checksum = ethers.getAddress(address);
  const artifact = readArtifact(artifactRel);
  const metadata = artifact.metadata;
  if (!metadata || !metadata.sources) {
    throw new Error(`Artifact ${artifactRel} has no embedded metadata.sources`);
  }

  const targetDir = path.join(
    SOURCIFY_REPO,
    "contracts",
    "full_match",
    String(chainId),
    checksum
  );
  fs.mkdirSync(path.join(targetDir, "sources"), { recursive: true });

  // Sourcify accepts the metadata object verbatim; pretty-print is fine
  // because for a *partial* match (which is what local-devnet contracts
  // realistically achieve, since byte-exact metadata reconstruction is
  // brittle) Sourcify only needs the file to be parseable JSON with a
  // matching `sources` map.
  fs.writeFileSync(
    path.join(targetDir, "metadata.json"),
    JSON.stringify(metadata, null, 2),
    "utf8"
  );

  // Copy each source under `sources/<originalPath>`.
  let copied = 0;
  for (const srcPath of Object.keys(metadata.sources)) {
    const onDisk = resolveSourcePath(srcPath);
    const dest = path.join(targetDir, "sources", srcPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(onDisk, dest);
    copied += 1;
  }

  return { checksum, sourcesCopied: copied, dir: targetDir };
}

module.exports = { resetRepo, publishContract };

// CLI mode for ad-hoc publishing:
//   node scripts/publish_sourcify.js <address> <artifactRel> [chainId=31337]
if (require.main === module) {
  const [, , address, artifactRel, chainIdArg] = process.argv;
  if (!address || !artifactRel) {
    console.error(
      "usage: node scripts/publish_sourcify.js <address> <artifactRel> [chainId]"
    );
    process.exit(1);
  }
  resetRepo(); // CLI invocation always wipes; programmatic callers control this.
  publishContract({
    address,
    chainId: chainIdArg ? Number(chainIdArg) : 31337,
    artifactRel,
  })
    .then((r) => {
      console.log("Published", r);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
