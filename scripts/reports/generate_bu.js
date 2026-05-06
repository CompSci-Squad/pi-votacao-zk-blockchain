/**
 * scripts/reports/generate_bu.js
 *
 * Boletim de Urna (BU) — final tally per race for an election.
 * Designed to be called AFTER closeElection().  Reads the on-chain view
 * `getBoletimUrna()` and writes a SHA-256-stamped JSON + MD pair.
 *
 * Usage:
 *   VOTING_ADDR=0x... node scripts/reports/generate_bu.js
 */
"use strict";

const { getProvider, getVoting, writeReport, RPC_URL, VOTING_ADDR } = require("./lib");

const STATES = ["PENDING", "OPEN", "FINISHED"];

async function main() {
  const provider = getProvider();
  const voting   = getVoting(provider);

  const [
    electionName,
    electionId,
    state,
    snapshots,
    voterCount,
    merkleRoot,
    grandTotal,
    blockTimestamp,
    blockNumber,
  ] = await voting.getBoletimUrna();

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
    kind: "boletim_de_urna",
    electionName,
    electionId,
    state: STATES[Number(state)] || `UNKNOWN(${state})`,
    voterCount,
    merkleRoot: "0x" + merkleRoot.toString(16).padStart(64, "0"),
    grandTotalVotes: grandTotal,
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
    `# Boletim de Urna — Eleição "${electionName}" (ID ${electionId})`,
    "",
    `- Estado: **${payload.state}**`,
    `- Bloco de captura: **${blockNumber}** (${new Date(Number(blockTimestamp) * 1000).toISOString()})`,
    `- Contrato: \`${VOTING_ADDR}\``,
    `- Eleitores registrados: **${voterCount}**`,
    `- Total de votos depositados (todos os cargos): **${grandTotal}**`,
    `- Merkle root: \`0x${merkleRoot.toString(16).padStart(64, "0")}\``,
    "",
    "## Resultados por cargo",
    ...races.flatMap((r) => {
      const top = [...r.candidates].sort((a, b) => Number(b.voteCount - a.voteCount));
      return [
        ``,
        `### Cargo ${r.raceId} — ${r.name}`,
        ``,
        `| # | Candidato | Partido | Nº | Votos |`,
        `|---|-----------|---------|----|-------|`,
        ...top.map(
          (c) => `| ${c.id} | ${c.name} | ${c.party} | ${c.number} | **${c.voteCount}** |`,
        ),
        ``,
        `- Brancos: **${r.blankVotes}** · Nulos: **${r.nullVotes}** · Total: **${r.totalVotes}**`,
      ];
    }),
    "",
    "---",
    "",
    "Integridade (SHA-256 do JSON canônico): `__SHA256__`",
  ].join("\n");

  const { jsonPath, mdPath, sha } = writeReport("bu", electionId, payload, md);
  console.log(`[bu] ${jsonPath}`);
  console.log(`[bu] ${mdPath}`);
  console.log(`[bu] sha256=${sha}`);
}

module.exports = main;
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
