/**
 * scripts/reports/generate_zeresima.js
 *
 * Zerésima (Brazilian electoral term) — an attestation, captured BEFORE the
 * polls open, that every counter on every race is exactly zero.
 *
 * Requires the contract to be in PENDING state.  Calls the on-chain view
 * `getZeresimaMultiRace()` and writes a SHA-256-stamped JSON + MD pair to
 * reports/runtime/.
 *
 * Usage:
 *   VOTING_ADDR=0x... node scripts/reports/generate_zeresima.js
 */
"use strict";

const { getProvider, getVoting, writeReport, RPC_URL, VOTING_ADDR } = require("./lib");

async function main() {
  const provider = getProvider();
  const voting   = getVoting(provider);

  const [
    electionName,
    electionId,
    snapshots,
    voterCount,
    merkleRoot,
    allZero,
    blockTimestamp,
    blockNumber,
  ] = await voting.getZeresimaMultiRace();

  const races = snapshots.map((s) => ({
    raceId: s.raceId,
    name: s.name,
    candidates: s.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      party: c.party,
      number: c.number,
      voteCount: c.voteCount,
    })),
    blankVotes: s.blankVotes,
    nullVotes:  s.nullVotes,
    totalVotes: s.totalVotes,
  }));

  const payload = {
    kind: "zeresima",
    electionName,
    electionId,
    voterCount,
    merkleRoot: "0x" + merkleRoot.toString(16).padStart(64, "0"),
    allZero,
    capturedAt: {
      blockNumber,
      blockTimestamp,
      isoUTC: new Date(Number(blockTimestamp) * 1000).toISOString(),
    },
    contractAddress: VOTING_ADDR,
    rpcUrl: RPC_URL,
    races,
  };

  const md = [
    `# Zerésima — Eleição "${electionName}" (ID ${electionId})`,
    "",
    `- Bloco de captura: **${blockNumber}**`,
    `- Timestamp: **${new Date(Number(blockTimestamp) * 1000).toISOString()}**`,
    `- Contrato: \`${VOTING_ADDR}\``,
    `- Eleitores registrados: **${voterCount}**`,
    `- Merkle root: \`0x${merkleRoot.toString(16).padStart(64, "0")}\``,
    `- Todos os contadores zerados? **${allZero ? "SIM ✅" : "NÃO ❌"}**`,
    "",
    "## Cargos",
    ...races.flatMap((r) => [
      ``,
      `### Cargo ${r.raceId} — ${r.name}`,
      ``,
      `| # | Candidato | Partido | Nº | Votos |`,
      `|---|-----------|---------|----|-------|`,
      ...r.candidates.map(
        (c) => `| ${c.id} | ${c.name} | ${c.party} | ${c.number} | ${c.voteCount} |`,
      ),
      ``,
      `- Brancos: **${r.blankVotes}** · Nulos: **${r.nullVotes}** · Total: **${r.totalVotes}**`,
    ]),
    "",
    "---",
    "",
    "Integridade (SHA-256 do JSON canônico): `__SHA256__`",
  ].join("\n");

  const { jsonPath, mdPath, sha } = writeReport("zeresima", electionId, payload, md);

  if (!allZero) {
    process.exitCode = 2;
    console.error(`[zeresima] ⚠️  contadores NÃO estão todos zero — auditar antes de abrir!`);
  }
  console.log(`[zeresima] ${jsonPath}`);
  console.log(`[zeresima] ${mdPath}`);
  console.log(`[zeresima] sha256=${sha}`);
}

module.exports = main;
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
