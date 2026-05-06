/**
 * scripts/reports/generate_rdv.js
 *
 * Registro Digital do Voto (RDV) — anonymous, deterministic export of every
 * vote cast.  Each entry is { raceId, candidateId, nullifier } — no voter
 * identity, no chain ordering.  Entries are sorted by keccak256(nullifier‖raceId)
 * so the output is independent of submission order.
 *
 * Implements the privacy-preserving spirit of the TSE's RDV: voters are not
 * linked to votes, but every individual ballot is auditable and the total
 * matches the Boletim de Urna.
 *
 * Usage:
 *   VOTING_ADDR=0x... node scripts/reports/generate_rdv.js
 */
"use strict";

const { ethers } = require("ethers");
const { getProvider, getVoting, writeReport, RPC_URL, VOTING_ADDR } = require("./lib");

async function main() {
  const provider = getProvider();
  const voting   = getVoting(provider);

  const electionName = await voting.electionName();
  const electionId   = await voting.currentElectionId();
  const blockNumber  = await provider.getBlockNumber();

  // Pull every VoteCast event from genesis.  In production this would use a
  // bounded range; for the PoC the chain is fresh per run.
  const filter = voting.filters.VoteCast();
  const events = await voting.queryFilter(filter, 0, blockNumber);

  const rows = events.map((ev) => {
    const { nullifier, raceId, candidateId } = ev.args;
    const tag = ethers.solidityPackedKeccak256(
      ["uint256", "uint256"],
      [nullifier, raceId],
    );
    return { raceId, candidateId, nullifier, _sortTag: tag };
  });

  // Deterministic order: keccak(nullifier ‖ raceId), ascending.
  rows.sort((a, b) => (a._sortTag < b._sortTag ? -1 : a._sortTag > b._sortTag ? 1 : 0));

  const ballots = rows.map((r) => ({
    raceId: r.raceId,
    candidateId: r.candidateId,
    nullifier: "0x" + r.nullifier.toString(16).padStart(64, "0"),
    sortTag: r._sortTag,
  }));

  // Per-race aggregates for cross-check against the BU.
  const perRace = new Map();
  for (const b of ballots) {
    const key = b.raceId.toString();
    if (!perRace.has(key)) {
      perRace.set(key, { raceId: b.raceId, count: 0n, candidates: new Map() });
    }
    const r = perRace.get(key);
    r.count += 1n;
    const ckey = b.candidateId.toString();
    r.candidates.set(ckey, (r.candidates.get(ckey) || 0n) + 1n);
  }
  const aggregates = [...perRace.values()].map((r) => ({
    raceId: r.raceId,
    totalBallots: r.count,
    perCandidate: [...r.candidates.entries()]
      .sort(([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0))
      .map(([candidateId, count]) => ({ candidateId: BigInt(candidateId), count })),
  }));

  const payload = {
    kind: "rdv",
    electionName,
    electionId,
    contractAddress: VOTING_ADDR,
    rpcUrl: RPC_URL,
    capturedAt: {
      blockNumber: BigInt(blockNumber),
      isoUTC: new Date().toISOString(),
    },
    totalBallots: BigInt(ballots.length),
    sortKey: "keccak256(nullifier || raceId), ascending",
    ballots,
    aggregates,
  };

  const md = [
    `# Registro Digital do Voto (RDV) — Eleição "${electionName}" (ID ${electionId})`,
    "",
    `- Total de cédulas: **${ballots.length}**`,
    `- Bloco de captura: **${blockNumber}**`,
    `- Contrato: \`${VOTING_ADDR}\``,
    `- Ordenação: \`keccak256(nullifier ‖ raceId)\`, ascendente (independente da ordem de envio).`,
    "",
    "## Agregados por cargo (cross-check com o BU)",
    "",
    ...aggregates.flatMap((r) => [
      `### Cargo ${r.raceId}`,
      "",
      `- Total: **${r.totalBallots}**`,
      `- Por candidato:`,
      ...r.perCandidate.map(
        (c) => `  - candidato ${c.candidateId}: **${c.count}**`,
      ),
      "",
    ]),
    "## Cédulas (anônimas, ordenadas)",
    "",
    "| sortTag | raceId | candidateId | nullifier |",
    "|---------|--------|-------------|-----------|",
    ...ballots.map(
      (b) =>
        `| \`${b.sortTag.slice(0, 18)}…\` | ${b.raceId} | ${b.candidateId} | \`${b.nullifier.slice(0, 18)}…\` |`,
    ),
    "",
    "---",
    "",
    "Integridade (SHA-256 do JSON canônico): `__SHA256__`",
  ].join("\n");

  const { jsonPath, mdPath, sha } = writeReport("rdv", electionId, payload, md);
  console.log(`[rdv] ${jsonPath}`);
  console.log(`[rdv] ${mdPath}`);
  console.log(`[rdv] sha256=${sha} (${ballots.length} ballots)`);
}

module.exports = main;
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
