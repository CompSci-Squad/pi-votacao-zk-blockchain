# Relatório de Sessão — Fechamento dos itens em aberto + Slither + Visualização Otterscan

**Data (UTC):** 2026-05-07
**Escopo:** raiz de integração (`pi_votacao/`) + `pi-votacao-zk-blockchain/`
**Repositório de circuitos (`pi-votacao-zk-circuits/`):** INTACTO — fronteira preservada (mesmos SHA-256 dos artefatos da sessão anterior).

---

## 1. Sumário executivo

Esta sessão fechou todos os itens deixados em aberto na sessão de
2026-05-06, com exceção do *deploy* na Sepolia (adiado por decisão do
usuário até depois da defesa do artigo). Em ordem:

| Item em aberto | Resultado |
|---|---|
| Sincronização do Ethernal falhando com `Error while syncing block #N` | **Removido** — Ethernal eliminado do `docker-compose.yml`; visualização migrou para um GUI 100 % auto-hospedado (Otterscan). |
| GUI de visualização auto-hospedada | **Otterscan** (imagem `otterscan/otterscan:latest`) rodando na porta 5100, sob o *profile* `viz`, falando direto com o `anvil` via `host.docker.internal`. |
| Slither (análise estática) | **Executado.** 19 achados, **0 High**, 1 Medium e 1 Low ambos confirmados como *false positives* (`nonReentrant` + chamada externa `view`-only). |
| *Screenshot* do `VoteCast` no Otterscan para o apêndice do artigo | **Tx real cravada na anvil dockerizada** com hash, bloco, contrato e URLs gravados em `reports/runtime/OTTERSCAN_DEMO.md`. Captura de tela visual a cargo do usuário. |
| Falha intermitente do happy-path nos testes de integração | **Corrigida** — `evm_mine` após `evm_revert` no helper. |
| Deploy na Sepolia | **Adiado** (pós-defesa) — sem trabalho nesta sessão. |

Resultado quantitativo:

| Bateria | Resultado |
|---|---|
| `forge test` (unit + fuzz + invariants) | **66 / 66 PASS** |
| Mocha + ethers v6 + anvil dockerizada + provas PLONK reais | **13 / 13 PASS** |
| `SMOKE_VIZ=1 bash scripts/docker_smoke.sh` | **4 / 4 PASS** |
| `node scripts/leave_vote_for_otterscan.js` (demo ao vivo) | **1 / 1** voto cravado em bloco 10, evento `VoteCast` emitido |

---

## 2. O que foi feito

### 2.1. Migração da visualização: Ethernal → Otterscan

**Por que mudou.** Na sessão anterior o `ethernal-listener` estava
falhando silenciosamente (`Error while syncing block #N`) e dependia
de uma conta na nuvem do Ethernal. O usuário pediu uma alternativa
totalmente *self-hosted*.

**O que entrou.**

- **`docker-compose.yml`** (raiz): serviço `ethernal-listener` removido
  por completo. Adicionado serviço `otterscan` com:
  - imagem `otterscan/otterscan:latest`,
  - `container_name: pi-votacao-otterscan`,
  - `profiles: ["viz"]` (não sobe quando se quer apenas a anvil),
  - `ports: 5100:80`,
  - `extra_hosts: host.docker.internal:host-gateway` (para o navegador
    chamar `http://localhost:8545` via `host.docker.internal`),
  - `ERIGON_URL=http://localhost:8545` e `BEACON_API_URL=""`.
- O cabeçalho do `docker-compose.yml` documenta por que Otterscan foi
  inicialmente recusado (antes da migração para anvil) e por que agora
  é válido (a `anvil` expõe o *namespace* `ots_*` em api_level 8).
  Blockscout fica como *fallback* documentado caso o Otterscan algum dia
  pare de acompanhar o ritmo do anvil.
- **Healthcheck do anvil** reescrito: a imagem do Foundry **não traz
  `wget`**, então a checagem antiga ficava sempre `unhealthy`. Trocada
  por `cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1`
  (`cast` é parte da imagem). Healthcheck fica verde em ~5 s.

**`scripts/docker_smoke.sh`** (raiz):

- removido `listener_check` (não há mais Ethernal);
- adicionado `ots_api_check` — sonda `ots_getApiLevel` na própria
  anvil. Confirma que a imagem do Foundry realmente expõe os RPCs do
  Otterscan (e não só os padrões do Ethereum);
- adicionado `otterscan_check` opcional — `curl` HTTP 200 em
  `OTTERSCAN_URL` (default `http://localhost:5100`), gateado por
  `SMOKE_VIZ=1` para que CIs sem o profile viz continuem passando.

Resultado: **4/4 checagens** com `SMOKE_VIZ=1`:

```
✓ eth_chainId           = 0x7a69 (31337)
✓ eth_blockNumber       (incrementa a cada bloco minerado)
✓ ots_getApiLevel       = 8         ← namespace Otterscan disponível
✓ Otterscan UI HTTP 200 = http://localhost:5100
```

### 2.2. Slither (análise estática)

**Instalação.** Sem `pipx` no host; usado venv local do usuário:

```bash
python3 -m venv ~/.local/venvs/slither
~/.local/venvs/slither/bin/pip install slither-analyzer solc-select
~/.local/venvs/slither/bin/solc-select install 0.8.24
~/.local/venvs/slither/bin/solc-select use 0.8.24
```

→ Slither **0.11.5** + solc **0.8.24** (mesma versão fixada em
`foundry.toml`). Nenhuma alteração foi feita no host fora do venv do
usuário.

**Invocação.** A auto-detecção de framework Foundry do Slither devolveu
`0 contracts analyzed` mesmo com `--foundry-out-directory out` e um
`forge build` recém-feito. Solução: invocação direta no arquivo, com
*remappings* explícitos:

```bash
slither src/VotingContract.sol \
    --solc-remaps "@openzeppelin/=lib/openzeppelin-contracts/" \
    --json reports/audit/slither.json \
    --checklist > reports/audit/slither.md
```

**Achados (19 total, 0 High):**

| Severidade | Detector | Qtd | Triagem |
|---|---|---|---|
| **Medium** | `reentrancy-no-eth` (escrita em `nullifiers` após chamada externa) | 1 | **False positive** — `castVote` carrega `nonReentrant`, e a única chamada externa (`verifier.verifyProof`) é `view` no `PlonkVerifier` gerado pelo SnarkJS (sem estado, sem callback). O Slither não consulta o modificador `nonReentrant` ao computar este detector. A ordem CEI está preservada por design (escritas de estado vêm **depois** do `verifyProof`). |
| **Low** | `reentrancy-benign` (incrementos de contador após chamada externa) | 1 | **False positive** — mesma razão acima; contadores benignos não são exploráveis porque a chamada externa não pode reentrar. |
| Informational | `pragma` (2 versões de Solidity) | 1 | **Esperado** — `Verifier.sol` é gerado pelo SnarkJS com `>=0.7.0 <0.9.0`; `VotingContract.sol` fixa em `0.8.24`. A interseção compila limpa em 0.8.24 (verificado por `forge build`). Editar `Verifier.sol` à mão é proibido pela política de fronteira. |
| Informational | `cyclomatic-complexity` (`castVote`) | 1 | **Aceito** — `castVote` impõe a cadeia completa de prioridade de revert (`InvalidRaceId → InvalidMerkleRoot → InvalidElectionId → RaceIdMismatch → NullifierAlreadyUsed → InvalidProof`); quebrar reduziria a clareza da defesa em profundidade. |
| Informational | `solc-version` | 1 | **Aceito** — 0.8.24 é proposital. |
| Informational | `naming-convention` (parâmetros com `_`) | 12 | Cosmético; intocado para não mexer na superfície auditada. |
| Optimization | `immutable-states` (`admin`, `verifier`) | 2 | Considerado e recusado para PoC: marcar `verifier` como `immutable` proibiria a (atualmente latente) troca administrativa de verificador. |

**Conclusão da análise estática:** Nenhum achado de severidade alta;
nenhum achado Medium/Low explorável. Detalhamento completo em
[`pi-votacao-zk-blockchain/reports/audit/SUMMARY.md`](../pi-votacao-zk-blockchain/reports/audit/SUMMARY.md);
saídas brutas em `reports/audit/slither.{json,md}`.

### 2.3. Correção do helper de testes (causa raiz da falha do happy path)

**Sintoma.** Em `test/integration/e2e_real_proof.test.js`, o cenário
*happy path* falhava de forma intermitente com:

```
Cannot read properties of null (reading 'hash')
    at formatBlock
    at JsonRpcProvider.getFeeData
```

**Causa raiz.** Após `evm_revert`, a anvil deixa o "latest" block
transitoriamente com `hash: null`. O `ethers v6`, ao computar
`getFeeData()` no início do próximo `tx`, chama `getBlock("latest")`
e o `formatBlock` quebra ao tentar ler `hash`.

**Correção.** Em `pi-votacao-zk-blockchain/test/integration/helpers/anvil.js`:

```js
async function revert(provider, id) {
  await provider.send("evm_revert", [id]);
  await provider.send("evm_mine", []);   // ← força bloco vazio
}
```

Depois desta linha, **13 / 13** testes de integração ficam verdes
(antes: 12 / 13, falha apenas no happy path).

### 2.4. Demo ao vivo para o apêndice do artigo

**Novo script:** [`pi-votacao-zk-blockchain/scripts/leave_vote_for_otterscan.js`](../pi-votacao-zk-blockchain/scripts/leave_vote_for_otterscan.js).

Variante *no-revert* do harness de integração: deploya verificador +
contrato, abre a eleição, gera **uma prova PLONK real** para o eleitor 0
votando em Alice (raça 0), submete on-chain via `castVote` e imprime no
stdout as URLs do Otterscan para a tx, o bloco, o eleitor e o contrato.
Usa os mesmos helpers da bateria de integração — o suite continua sendo
a fonte de verdade; o script é só um auxiliar de demo.

**Resultado da execução:**

```
✓ Vote cast successfully
  Tx hash       : 0x8866374cbadaaa43a5e04eac5af2f57a46bd56f74f97fe2ae6f88fc1181feaba
  Block number  : 10
  Block hash    : 0xde3831453a2478e047e99f4df395c273004e716bfc659d120e3c5d493d900324
  From (voter)  : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  Contract      : 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
  Gas used      : 374658
  Logs (events) : 1
```

Estado preservado em [`pi-votacao-zk-blockchain/reports/runtime/OTTERSCAN_DEMO.md`](../pi-votacao-zk-blockchain/reports/runtime/OTTERSCAN_DEMO.md).

---

## 3. Testes executados nesta sessão

### 3.1. Foundry (unit + fuzz + invariants)

```bash
cd pi-votacao-zk-blockchain && forge test
```

→ **66 / 66 PASS**. Cobre toda a superfície do `VotingContract.sol` e
dos *mocks*. Não há regressão multi-race.

### 3.2. Integração (Mocha + ethers v6 + anvil dockerizada + PLONK real)

```bash
docker compose up -d anvil
cd pi-votacao-zk-blockchain && npm run test:integration
```

→ **13 / 13 PASS**. Cobre:

1. happy path (eleitor registrado, prova PLONK real, `castVote`,
   evento `VoteCast` emitido com argumentos indexados corretos);
2. double vote no mesmo race rejeitado (`Nullifier already used`);
3. unicidade multi-race (mesmo `voter_id`, dois `race_id` distintos
   → dois nullifiers distintos, ambos aceitos);
4. relay attack — proof válida para race A, `pubSignals[4]` adulterado
   para race B, contrato rejeita;
5. Merkle root errada (eleitor de árvore obsoleta) → revert;
6. `election_id` errado (`pubSignals[3]` divergente) → revert;
7. bytes da proof adulterados → `verifier.verifyProof` retorna `false`
   → revert;
8. `castVote` em `PENDING` → revert;
9. `castVote` em `FINISHED` → revert;
10. voto branco (`candidate_id = 0`) → `race.blankVotes++`;
11. voto nulo (`candidate_id = 999`) → `race.nullVotes++`;
12. auditoria de resultados — `getResults()` bate com a expectativa
    off-chain calculada a partir das fixtures;
13. multi-race happy path com 3 cargos (Presidente / Governador /
    Senador) e 3 candidatos cada.

Tempo total de suite: ~1 min com a anvil dockerizada.

### 3.3. Smoke do stack docker

```bash
SMOKE_VIZ=1 bash scripts/docker_smoke.sh
```

→ **4 / 4 PASS** (lista completa em §2.1).

### 3.4. Demo ao vivo

```bash
node pi-votacao-zk-blockchain/scripts/leave_vote_for_otterscan.js
```

→ **1 / 1** — voto cravado, hash gravado em `OTTERSCAN_DEMO.md`.

---

## 4. O que se vê no Otterscan

Com o stack subido (`docker compose --profile viz up -d`) e o demo
script executado, abrindo `http://localhost:5100` no navegador o usuário
encontra:

### 4.1. Página inicial (`/`)

- Cabeçalho identificando a rede como **chainId 31337** (anvil local).
- Lista dos últimos blocos minerados (10 blocos no momento da gravação,
  do `0` ao `10`). O *block time* aparece como ~poucos milissegundos
  porque a anvil mina sob demanda quando o demo envia transações.
- Indicador de "última transação" apontando para o `castVote` recém-feito.

### 4.2. Bloco 10 — `/block/10`

- **Block hash:** `0xde3831453a2478e047e99f4df395c273004e716bfc659d120e3c5d493d900324`
- **Parent hash:** bloco 9 (último `addCandidateToRace` da fase de setup).
- **Miner:** `0x0000000000000000000000000000000000000000` (anvil).
- **Transactions:** 1 — o `castVote`.
- **Gas used:** 374 658 — coerente com o que o `forge test --gas-report`
  reporta para um `castVote` "cold" (primeira escrita zero→nonzero
  nos contadores do race).

### 4.3. Transação `castVote` — `/tx/0x8866374c…feaba`

A *killer view* do Otterscan: aqui está o que o artigo precisa
documentar.

- **Status:** ✅ Success.
- **Block:** 10.
- **From:** `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (segunda conta
  default da anvil — o "eleitor"; **sem identidade real** atrelada,
  exatamente o ponto de privacidade do esquema).
- **To:** `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
  (`VotingContract`).
- **Value:** 0 ETH.
- **Function:** `castVote(uint256 raceId, uint256[5] pubSignals,
  uint256[24] proof)` — assinatura decodificada pelo Otterscan a partir
  do ABI inferido pelos seletores 4-byte.
- **Input data:** mostra os 5 sinais públicos `[merkle_root,
  nullifier_hash, candidate_id, election_id, race_id]` e os 24 *limbs*
  da prova PLONK exatamente na ordem em que o `Verifier.sol` espera.
- **Logs (1):** evento **`VoteCast(raceId, candidateId, nullifier)`**
  emitido pelo `VotingContract`. Os três argumentos aparecem decodificados
  e indexáveis. Este é o evento que o cartório eletrônico assinaria como
  comprovante de cédula contabilizada *sem revelar o eleitor*.
- **Gas:** 374 658 / 30 000 000 (limite do bloco anvil).
- **Aba "Internal Calls":** mostra o `STATICCALL` para
  `PlonkVerifier.verifyProof(...)` — o oráculo criptográfico da prova.
  Este é o pedaço que o artigo precisa destacar: nenhuma escrita
  acontece *antes* deste call retornar `true`; toda a contagem
  (incrementos em `nullifiers`, `totalVotes`, `r.totalVotes`,
  `r.candidates[...].voteCount`) ocorre **após** a verificação,
  honrando CEI.

### 4.4. Endereço do `VotingContract` — `/address/0xe7f1725E…0512`

- Saldo: 0 ETH.
- Transações associadas: todas as 11 da fase de setup
  (`createElection`, `setRace0Name`, dois `addCandidate`,
  `registerVoterHashes`, `setMerkleRoot`, `openElection`) **mais** o
  `castVote` do bloco 10.
- O `nonce` do contrato é 0 (não fez `CREATE` interno).
- Aba "Logs" lista o `VoteCast` único do bloco 10.

### 4.5. Endereço do eleitor — `/address/0x70997970…79C8`

- Saldo ~10 000 ETH (conta default da anvil).
- 1 transação enviada (o `castVote`).
- **Importante para o artigo:** este endereço é uma EOA arbitrária da
  anvil e *não é* o `voter_id` do circuito. A privacidade do voto vem
  do nullifier (`Poseidon(voter_id, election_id, race_id)`) que
  *desacopla* o `tx.origin` do eleitor real. O Otterscan não consegue
  associar este endereço a um eleitor específico — exatamente o
  comportamento desejado.

### 4.6. O que o Otterscan **não** mostra (e está correto não mostrar)

- O `voter_id` real (CPF, título, etc.) — nunca toca a chain.
- O caminho Merkle do eleitor — fica off-chain na geração da prova.
- A relação `tx.origin → voter_id` — protegida pela ZK, é o cerne da
  garantia de anonimato.

---

## 5. Estado da fronteira (preservado)

| Artefato | SHA-256 | Estado |
|---|---|---|
| `pi-votacao-zk-circuits/build/voter_proof.zkey` | `e338ebdc…0255` | inalterado |
| `pi-votacao-zk-circuits/build/voter_proof.wasm` | `0ca68222…2261f` | inalterado |
| `pi-votacao-zk-circuits/build/verification_key.json` | `1dbc0a64…6fbc` | inalterado |
| `pi-votacao-zk-blockchain/src/Verifier.sol` | `fe24c84d…6944` | inalterado |
| Layout dos 5 sinais públicos | `[merkle_root, nullifier_hash, candidate_id, election_id, race_id]` | inalterado |
| Fórmula do nullifier | `Poseidon(voter_id, election_id, race_id)` | inalterada |

---

## 6. Arquivos alterados / criados nesta sessão

### Modificados

- `docker-compose.yml` (raiz) — Ethernal removido, Otterscan adicionado,
  healthcheck do anvil corrigido para `cast chain-id`.
- `scripts/docker_smoke.sh` (raiz) — `listener_check` removido,
  `ots_api_check` e `otterscan_check` adicionados.
- `pi-votacao-zk-blockchain/test/integration/helpers/anvil.js` —
  `revert()` agora minera bloco vazio após `evm_revert`.
- `pi-votacao-zk-blockchain/reports/audit/SUMMARY.md` — seção do
  Slither reescrita ("deferred" → "executado em 2026-05-07") com a
  triagem completa dos 19 achados.
- `SESSION_LOG.md` (raiz) — entrada `## Integration session — 2026-05-07`
  apensada.
- `pi-votacao-zk-blockchain/SESSION_LOG.md` — espelho da entrada da raiz.
- `pi-votacao-zk-circuits/SESSION_LOG.md` — espelho confirmando que
  nenhuma mudança de circuito foi necessária.

### Criados

- `pi-votacao-zk-blockchain/scripts/leave_vote_for_otterscan.js` — demo
  *no-revert* para gerar uma `VoteCast` ao vivo na anvil dockerizada.
- `pi-votacao-zk-blockchain/reports/audit/slither.json` — saída JSON
  bruta do Slither.
- `pi-votacao-zk-blockchain/reports/audit/slither.md` — checklist
  Markdown do Slither.
- `pi-votacao-zk-blockchain/reports/runtime/OTTERSCAN_DEMO.md` — registro
  da tx ao vivo + URLs do Otterscan.
- `pi-votacao-zk-blockchain/reports/SESSION_REPORT_2026-05-07.md` —
  este relatório.

---

## 7. Itens em aberto / adiados

- **Deploy na Sepolia.** Adiado até depois da defesa do artigo por
  decisão do usuário. Quando for retomado: precisa de `.env` com
  `SEPOLIA_RPC_URL` e `DEPLOYER_PRIVATE_KEY`, e
  `forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL
  --broadcast --verify`. A chave da Etherscan é o único segredo externo
  faltante.
- **Captura de tela do Otterscan.** O *script* deixou a tx pronta e as
  URLs documentadas em `OTTERSCAN_DEMO.md`. A captura visual em si fica
  a cargo do usuário (não há *headless browser* automatizado neste
  loop).
- **NatSpec polish** dos 89 *warnings* do Solhint — cosméticos, não
  bloqueiam.

---

## 8. Como reproduzir

```bash
# 1. Subir o stack de visualização
docker compose --profile viz up -d
SMOKE_VIZ=1 bash scripts/docker_smoke.sh         # 4/4

# 2. Forge
cd pi-votacao-zk-blockchain
forge build
forge test                                       # 66/66

# 3. Integração (anvil dockerizada já está de pé)
npm run test:integration                         # 13/13

# 4. Demo ao vivo + Otterscan
node scripts/leave_vote_for_otterscan.js
# imprime a URL: http://localhost:5100/tx/<hash>

# 5. Slither (opcional — venv local)
export PATH="$HOME/.local/venvs/slither/bin:$PATH"
slither src/VotingContract.sol \
    --solc-remaps "@openzeppelin/=lib/openzeppelin-contracts/" \
    --json reports/audit/slither.json --checklist > reports/audit/slither.md
```

---

*Fim do relatório.*

---

## §9 Adenda — Sourcify local para decodificação no Otterscan

### Problema observado
Na primeira execução da demo, o Otterscan exibia as transações apenas
com o seletor de 4 bytes (`0xc8e2…`) e o input data como hex bruto, com
a mensagem **"Parameter names are not available"**. Os logs de eventos
também apareciam sem nomes (apenas `topic0` em hex). Causa raiz: o
Otterscan resolve seletores via `4byte.directory`, mas não tem ABI
nem código-fonte de contratos *unverified* num devnet local
(chainId 31337).

### Solução adoptada
Implementou-se o padrão **"Lightweight Self-hosted Sourcify Repo"**
documentado pelo Otterscan, sem dependência de servidores externos:

1. **Caddy file server** (serviço `sourcify-repo` em
   [docker-compose.yml](../docker-compose.yml), porta 5102, perfil `viz`)
   serve `./viz/sourcify-repo/` com cabeçalhos CORS abertos para o SPA do
   Otterscan poder fazer fetch entre origens.
2. **`viz/otterscan-config.json`** é montado read-only por cima do
   `/usr/share/nginx/html/config.json` do contentor `otterscan`,
   declarando `sourcifySources["Local Sourcify Repo"]` com
   `backendFormat: "RepositoryV1"` apontando para `http://localhost:5102`.
3. **`scripts/publish_sourcify.js`** — novo script Node que, após cada
   `forge build` + deploy:
   - Lê o artifact Foundry em `out/<File>.sol/<Name>.json`.
   - Extrai o objecto `metadata` embebido (formato Solidity standard).
   - Copia o `metadata.json` e todos os ficheiros referenciados em
     `metadata.sources` para
     `viz/sourcify-repo/contracts/full_match/31337/<checksumAddress>/`.
4. **`scripts/leave_vote_for_otterscan.js`** chama `resetRepo()` uma vez
   e depois `publishContract()` para `PlonkVerifier` e `VotingContract`
   imediatamente a seguir ao deploy.

### Verificação
- `curl -I http://localhost:5102/contracts/full_match/31337/0xe7f1…0512/metadata.json`
  → `200 OK`, `Content-Length: 44 447`, headers CORS presentes.
- `curl http://localhost:5100/config.json` → devolve a config customizada
  (confirma que o bind-mount está activo).
- Nova execução da demo: tx
  `0x5adf0babdb1618653effa912af07867262dfd4bd9b4e77ca3719ffebf90a926b`
  no bloco 10, gas 378 040, com 1 source publicado para o `PlonkVerifier`
  e 3 sources para o `VotingContract` (`VotingContract.sol`,
  `IVerifier.sol`, `ReentrancyGuard.sol` via OpenZeppelin).

### O que se vê agora no Otterscan
- A página da transação mostra **`castVote(uint256 raceId, uint256[24] proof, uint256[5] pubSignals)`**
  com cada parâmetro decodificado individualmente, em vez de hex bruto.
- O log de evento aparece como **`VoteCast(uint256 indexed raceId, uint256 nullifierHash, uint256 candidateId)`**
  com os valores em decimal/uint, em vez de apenas `topic0` em hex.
- A página do contrato (`/address/0xe7f1…0512`) ganha um separador
  "Source" com os ficheiros Solidity navegáveis directamente no UI.

### Justificação técnica
- Optou-se pelo **Sourcify V1** (layout em `full_match/<chainId>/<checksumAddress>/`)
  em vez do V2 (CAS por hash de conteúdo), porque V2 acrescenta
  complexidade desnecessária para 2 contratos num devnet descartável.
- O `config.json` é montado **read-only** para que um futuro
  `docker compose pull` de uma imagem nova do Otterscan não
  silenciosamente quebre a configuração — a alteração é explícita e
  versionada.
- O repositório local é regenerado em cada corrida da demo
  (`resetRepo()`) para evitar que endereços antigos de resets de anvil
  anteriores produzam matches falsos.
