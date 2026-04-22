# pi-votacao-zk-blockchain

Sistema de votação eletrônica acadêmica baseado em **Ethereum** e **ZK-SNARKs** (PLONK).

O contrato inteligente é a **única fonte de verdade** — nenhum banco de dados externo é necessário. As provas de conhecimento zero garantem o sigilo do voto enquanto permitem verificação pública da eleição.

> **Prova de conceito** projetada para **15 eleitores**, **2 candidatos** e **1 cargo** (`raceId = 0`).

---

## Arquitetura

```
pi-votacao-zk-blockchain/
├── contracts/
│   ├── VotingContract.sol         # Contrato principal
│   ├── Verifier.sol               # Placeholder — substituído pelo arquivo gerado pelo SnarkJS
│   ├── MockVerifier.sol           # Verifier de teste que sempre aceita
│   └── RejectingMockVerifier.sol  # Verifier de teste que sempre rejeita
├── scripts/
│   ├── deploy.js                  # Deploy dos contratos
│   └── interact.js                # Demonstração end-to-end
├── test/
│   ├── helpers/fixtures.js        # Fixtures e helpers compartilhados
│   ├── deployment.test.js
│   ├── admin-setup.test.js
│   ├── lifecycle.test.js
│   ├── cast-vote.test.js
│   ├── zeresima.test.js
│   └── results.test.js
├── docs/IMPLEMENTATION_PLAN.md
├── hardhat.config.js
└── package.json
```

### Fluxo de uma eleição

```
PENDING ──(openElection)──▶ OPEN ──(closeElection)──▶ FINISHED
```

| Estado     | Operações permitidas                                                                              |
|------------|---------------------------------------------------------------------------------------------------|
| `PENDING`  | `createElection`, `addCandidate`, `registerVoterHashes`, `setMerkleRoot`, `getZeresima`, `openElection` |
| `OPEN`     | `castVote`, `closeElection`                                                                       |
| `FINISHED` | `getResults`, `getRaceResults`, `getCandidates`, `getVoterHashes` (leitura pública)               |

A máquina de estado é **unidirecional**: nenhum caminho permite regredir.

### Sinais públicos do circuito ZK (`voter_proof.circom`)

Ordem canônica — **fixa** e validada on-chain antes da verificação da prova:

| Índice | Sinal             | Significado                                                              |
|--------|-------------------|--------------------------------------------------------------------------|
| `[0]`  | `merkle_root`     | Raiz da Merkle tree de eleitores autorizados (deve bater com a on-chain) |
| `[1]`  | `nullifier_hash`  | `Poseidon(voter_id, election_id, race_id)` — anti-voto-duplo             |
| `[2]`  | `candidate_id`    | `0` = branco, `999` = nulo, `1..N` = candidato válido                     |
| `[3]`  | `election_id`     | Identificador da eleição (deve bater com a on-chain)                     |
| `[4]`  | `race_id`         | Identificador do cargo (PoC: sempre `0`)                                  |

> ⚠️ **`raceId` ≠ `candidateId`**. `raceId` identifica o **cargo** (presidente, prefeito etc.). `candidateId` identifica o **candidato** dentro do cargo (`0` = branco, `999` = nulo).

---

## Auditabilidade Pública

Toda mudança de estado emite um evento indexado, permitindo reconstrução e auditoria a partir do explorador on-chain (Etherscan):

| Evento                    | Argumentos                                                          |
|---------------------------|---------------------------------------------------------------------|
| `ElectionCreated`         | `name`, `electionId`                                                |
| `CandidateAdded`          | `id`, `name`, `number`                                              |
| `VoterHashesRegistered`   | `hashes[]`                                                          |
| `MerkleRootSet`           | `root`                                                              |
| `ElectionOpened`          | `timestamp`                                                         |
| **`VoteCast`**            | **`indexed nullifier`, `indexed raceId`, `indexed candidateId`**    |
| `ElectionClosed`          | `timestamp`, `totalVotes`                                           |

Como nenhum dado é armazenado fora da blockchain, qualquer pessoa pode auditar a eleição completa apenas escutando os eventos do contrato.

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) ≥ 18.18 (recomendado 20 LTS)
- [npm](https://www.npmjs.com/) ≥ 9
- Conta na [Infura](https://infura.io/) ou [Alchemy](https://www.alchemy.com/) (somente para Sepolia)
- Conta no [Etherscan](https://etherscan.io/) com chave de API (somente para verificação)

---

## Instalação

```bash
git clone https://github.com/CompSci-Squad/pi-votacao-zk-blockchain.git
cd pi-votacao-zk-blockchain
npm install
```

Configure as variáveis de ambiente (apenas para deploy em rede pública):

```bash
cp .env.example .env
# Edite .env com RPC_URL, PRIVATE_KEY e ETHERSCAN_API_KEY
```

---

## Compilação

```bash
npm run compile
```

Os artefatos são gerados em `artifacts/`.

---

## Testes

A suíte de testes é escrita em **JavaScript** com **Hardhat 2 LTS + Mocha + Chai** (via `@nomicfoundation/hardhat-chai-matchers`).

```bash
npm test
```

A suíte cobre:

- Deploy e estado inicial
- Setup admin (createElection, addCandidate, registerVoterHashes, setMerkleRoot)
- Máquina de estado (openElection / closeElection)
- `castVote` — happy paths, ordenação canônica dos sinais públicos, CEI, double-vote, validação de cada sinal, gating de estado
- Voto branco (`candidateId=0`), voto nulo (`candidateId=999`)
- `getZeresima`, `getResults`, `getRaceResults`

Para cobertura:

```bash
npm run test:coverage
```

---

## Deploy

### Local (node Hardhat)

```bash
# Terminal 1
npx hardhat node

# Terminal 2
npm run deploy:local
```

### Sepolia

```bash
npm run deploy:sepolia
```

O script imprime os endereços e tenta verificar automaticamente no Etherscan.

### Substituir o `Verifier` placeholder

Após gerar o `Verifier.sol` real com SnarkJS no repositório `pi-votacao-zk-circuits`:

1. Copie o arquivo gerado para `contracts/Verifier.sol` (sobrescrevendo o placeholder).
2. Confira que `verifyProof(bytes memory, uint256[] memory) returns (bool)` casa com a interface `IVerifier`.
3. Confira que o circuito expõe **5 sinais públicos** na ordem canônica.
4. Recompile e faça novo deploy.

---

## Interação pós-deploy

```bash
VOTING_ADDRESS=0x... npm run interact:local
# ou
VOTING_ADDRESS=0x... npm run interact:sepolia
```

---

## Limitações declaradas

- **Sem auditoria formal.** O contrato implementa CEI estrito e usa `ReentrancyGuard` como defesa-em-profundidade, mas não passou por auditoria de terceiros.
- **`registerVoterHashes` não é incremental.** A função pode ser chamada **uma única vez** por eleição (idempotência via `VoterHashesAlreadyRegistered`). Lotes parciais não são suportados nesta versão.
- **Busca linear de candidatos.** `_incrementCandidateVote` percorre o array linearmente. Aceitável para 2 candidatos; para escalas maiores convém substituir por mapping.
- **Custo de gás da verificação PLONK.** A verificação on-chain custa ~280k–400k gás por voto.
- **PoC monocargo.** Apenas `raceId = 0` é aceito. A estrutura de dados (`mapping(uint256 => mapping(uint256 => bool)) nullifiers`) já é multi-cargo, mas a lógica de cargo é restringida ao caso 0 nesta versão.
- **Verifier ainda é placeholder.** O arquivo real será gerado pelo `pi-votacao-zk-circuits` e copiado neste repo.

---

## Endereços implantados

> Atualizado em cada deploy.

| Rede     | Contrato         | Endereço |
|----------|------------------|----------|
| Sepolia  | `Verifier`       | —        |
| Sepolia  | `VotingContract` | —        |

---

## Licença

MIT
