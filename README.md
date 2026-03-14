# pi-votacao-zk-blockchain

Sistema de votação eletrônica acadêmica baseado em **Ethereum** e **ZK-SNARKs** (Groth16).

O contrato inteligente é a **única fonte de verdade** — nenhum banco de dados externo é necessário.  
As provas de conhecimento zero garantem o sigilo do voto enquanto permitem verificação pública da eleição.

> **Prova de conceito** projetada para **15 eleitores** e **2 candidatos**.

---

## Arquitetura

```
votacao-zk-blockchain/
├── contracts/
│   ├── VotingContract.sol   # Contrato principal
│   ├── Verifier.sol         # Placeholder — será substituído pelo gerado pelo SnarkJS
│   └── MockVerifier.sol     # Verifier falso para testes unitários
├── scripts/
│   ├── deploy.js            # Deploy dos contratos
│   └── interact.js          # Scripts de interação para testes manuais
├── test/
│   └── VotingContract.test.js  # Testes unitários com Hardhat + Chai
├── hardhat.config.js
├── package.json
├── .env.example
└── .gitignore
```

### Fluxo de uma eleição

```
PENDING ──(openElection)──▶ OPEN ──(closeElection)──▶ FINISHED
```

| Estado     | Operações permitidas                                        |
|------------|-------------------------------------------------------------|
| `PENDING`  | `createElection`, `addCandidate`, `registerVoterHashes`, `setMerkleRoot`, `openElection` |
| `OPEN`     | `castVote`, `closeElection`                                 |
| `FINISHED` | `getResults` (leitura pública)                              |

### Sinais públicos do circuito ZK

| Índice | Significado |
|--------|-------------|
| `[0]`  | `nullifier` — impede votação dupla |
| `[1]`  | `candidateId` — `0` = voto em branco, `MaxUint256` = voto nulo, `1..N` = candidato válido |

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) ≥ 18
- [npm](https://www.npmjs.com/) ≥ 9
- Conta na [Infura](https://infura.io/) ou [Alchemy](https://www.alchemy.com/) (para Sepolia)
- Conta no [Etherscan](https://etherscan.io/) com chave de API (para verificação)

---

## Instalação

```bash
git clone https://github.com/CompSci-Squad/pi-votacao-zk-blockchain.git
cd pi-votacao-zk-blockchain
npm install
```

Configure as variáveis de ambiente:

```bash
cp .env.example .env
# Edite .env com suas chaves
```

---

## Como compilar os contratos

```bash
npm run compile
# ou
npx hardhat compile
```

Os artefatos serão gerados em `artifacts/`.

---

## Como rodar os testes

```bash
npm test
# ou
npx hardhat test
```

Para relatório de cobertura:

```bash
npm run test:coverage
```

Os testes utilizam `MockVerifier` para simular a verificação ZK localmente.

---

## Como fazer deploy na Sepolia

1. Preencha `.env` com `RPC_URL`, `PRIVATE_KEY` e `ETHERSCAN_API_KEY`.
2. Certifique-se de que a carteira tem ETH de teste (use um [faucet Sepolia](https://sepoliafaucet.com/)).
3. Execute:

```bash
npm run deploy:sepolia
# ou
npx hardhat run scripts/deploy.js --network sepolia
```

O script imprimirá os endereços dos contratos implantados e tentará a verificação automática no Etherscan.

### Substituir o Verifier placeholder

Após gerar o `Verifier.sol` real com o SnarkJS no repositório de circuitos:

1. Copie o arquivo gerado para `contracts/Verifier.sol` (sobrescrevendo o placeholder).
2. Recompile: `npm run compile`.
3. Faça um novo deploy.

---

## Interação pós-deploy

```bash
VOTING_ADDRESS=0x... VERIFIER_ADDRESS=0x... npm run interact:sepolia
```

O script `interact.js` demonstra o ciclo completo: criar eleição → adicionar candidatos → registrar eleitores → abrir → votar → encerrar → consultar resultados.

---

## Endereço do contrato deployado

> Será preenchido após o primeiro deploy na Sepolia.

| Contrato        | Endereço |
|-----------------|----------|
| `Verifier`      | —        |
| `VotingContract`| —        |

---

## Licença

MIT
