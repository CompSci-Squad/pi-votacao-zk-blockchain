"""
conftest.py — fixtures and helpers shared across all test modules.

Prerequisites:
  1. Compile contracts:  cd .. && npx hardhat compile
  2. Run local node:     npx hardhat node   (keep running in a separate terminal)
  3. Run tests:          pytest tests/ -v

Connection: Hardhat local node at http://127.0.0.1:8545 (default).
"""

import json
from pathlib import Path

import pytest
from web3 import Web3
from web3.exceptions import ContractLogicError  # noqa: F401  (re-exported for tests)

# ── Constants ─────────────────────────────────────────────────────────────────

DEPTH       = 4
MAX_VOTERS  = 2 ** DEPTH   # 16
ELECTION_ID = 1
RACE_ID     = 1

ELECTION_NAME = "Eleicao Teste PoC"
ELECTION_DESC = "Prova de Conceito - IMT"

# 15 non-zero deterministic voter hashes.
# In production: Poseidon(voter_id) for each registered voter.
# With MockVerifier the contract never verifies these cryptographically —
# any non-zero uint256 values satisfy the ZK circuit tests.
VOTER_HASHES = [
    0xAAAA0001, 0xAAAA0002, 0xAAAA0003, 0xAAAA0004, 0xAAAA0005,
    0xAAAA0006, 0xAAAA0007, 0xAAAA0008, 0xAAAA0009, 0xAAAA000A,
    0xAAAA000B, 0xAAAA000C, 0xAAAA000D, 0xAAAA000E, 0xAAAA000F,
]  # len == 15

# Fixed Merkle root stored in the contract.
# Any non-zero value is valid here; we set it with setMerkleRoot()
# and echo the same value in pubSignals[0] when calling castVote().
MERKLE_ROOT = 0xDEADBEEFCAFEBABE

# Candidate fixture data
CANDIDATE_A = ("Alice Oliveira", "PT",  13)
CANDIDATE_B = ("Bruno Silva",    "PSD", 45)

# Proof bytes — MockVerifier ignores proof content
EMPTY_PROOF = b""


# ── Path helpers ──────────────────────────────────────────────────────────────

_ARTIFACTS = Path(__file__).parent.parent / "artifacts" / "contracts"


def load_artifact(contract_name: str) -> dict:
    """Return the full Hardhat artifact dict for *contract_name*."""
    path = _ARTIFACTS / f"{contract_name}.sol" / f"{contract_name}.json"
    if not path.exists():
        pytest.skip(
            f"Artifact not found: {path}. "
            "Run `npx hardhat compile` before running the tests."
        )
    with open(path) as fh:
        return json.load(fh)


def load_abi(contract_name: str) -> list:
    return load_artifact(contract_name)["abi"]


# ── Domain helpers ────────────────────────────────────────────────────────────

def make_nullifier(
    voter_index: int,
    election_id: int = ELECTION_ID,
    race_id: int = RACE_ID,
) -> int:
    """
    Return a deterministic unique nullifier for testing.

    In production this equals Poseidon(voter_id, election_id, race_id).
    When using MockVerifier, any unique uint256 value is sufficient — the
    contract's only check is that the same nullifier is not used twice.
    """
    return (voter_index + 1) * 10 ** 18 + election_id * 10 ** 9 + race_id


def make_pub_signals(
    nullifier: int,
    candidate_id: int,
    election_id: int = ELECTION_ID,
    race_id: int = RACE_ID,
    merkle_root: int = MERKLE_ROOT,
) -> tuple:
    """
    Build the canonical 5-element pubSignals tuple for castVote().

    Layout mirrors IVerifier.sol / voter_proof.circom:
      [0] merkle_root
      [1] nullifier_hash
      [2] candidate_id
      [3] election_id
      [4] race_id
    """
    return (merkle_root, nullifier, candidate_id, election_id, race_id)


# ── Session-scoped fixtures (shared across all tests) ─────────────────────────

@pytest.fixture(scope="session")
def w3():
    """Web3 connection to a running Hardhat local node."""
    provider = Web3(Web3.HTTPProvider("http://127.0.0.1:8545"))
    if not provider.is_connected():
        pytest.skip(
            "Hardhat local node is not running. "
            "Start it with: npx hardhat node"
        )
    return provider


@pytest.fixture(scope="session")
def accounts(w3):
    return w3.eth.accounts


@pytest.fixture(scope="session")
def admin(accounts):
    """First Hardhat test account — plays the election administrator role."""
    return accounts[0]


@pytest.fixture(scope="session")
def voter1(accounts):
    return accounts[1]


@pytest.fixture(scope="session")
def non_admin(accounts):
    """Account with no admin privileges — used for access-control tests."""
    return accounts[2]


# ── Function-scoped contract fixtures ─────────────────────────────────────────

@pytest.fixture(scope="function")
def mock_verifier(w3, admin):
    """Deploy a fresh MockVerifier for each test function."""
    artifact = load_artifact("MockVerifier")
    contract = w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"])
    tx_hash = contract.constructor().transact({"from": admin})
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    return w3.eth.contract(address=receipt.contractAddress, abi=artifact["abi"])


@pytest.fixture(scope="function")
def voting_contract(w3, admin, mock_verifier):
    """
    Deploy a fresh VotingContract for each test function.

    The contract is wired to the *mock_verifier* deployed in the same test,
    so both fixtures share the same MockVerifier instance — essential for
    tests that call getLastPubSignal() after castVote().
    """
    artifact = load_artifact("VotingContract")
    contract = w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"])
    tx_hash = contract.constructor(mock_verifier.address).transact({"from": admin})
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    return w3.eth.contract(address=receipt.contractAddress, abi=artifact["abi"])


@pytest.fixture(scope="function")
def pending_setup(w3, admin, voting_contract):
    """
    Set up an election in PENDING state with:
      - election created
      - 2 candidates added (numbers 13 and 45)
      - 15 voter hashes registered
      - Merkle root set

    Returns the VotingContract instance (still PENDING — NOT opened).
    """
    vc = voting_contract

    vc.functions.createElection(ELECTION_NAME, ELECTION_DESC).transact({"from": admin})
    vc.functions.addCandidate(*CANDIDATE_A).transact({"from": admin})
    vc.functions.addCandidate(*CANDIDATE_B).transact({"from": admin})
    vc.functions.registerVoterHashes(VOTER_HASHES).transact({"from": admin})
    vc.functions.setMerkleRoot(MERKLE_ROOT).transact({"from": admin})

    return vc


@pytest.fixture(scope="function")
def election_ready(w3, admin, pending_setup):
    """
    Fully configured VotingContract in OPEN state (ready to receive votes).

    Extends *pending_setup* by calling openElection().
    """
    pending_setup.functions.openElection().transact({"from": admin})
    return pending_setup
