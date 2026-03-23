"""
test_election_admin.py — admin-only management functions:
  createElection, addCandidate, registerVoterHashes, setMerkleRoot,
  openElection, closeElection.
"""

import pytest
from conftest import (
    ELECTION_DESC,
    ELECTION_NAME,
    MERKLE_ROOT,
    VOTER_HASHES,
    CANDIDATE_A,
    CANDIDATE_B,
)


class TestCreateElection:
    def test_create_election_sets_name(self, w3, admin, voting_contract):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        assert voting_contract.functions.electionName().call() == ELECTION_NAME

    def test_create_election_sets_description(self, w3, admin, voting_contract):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        assert voting_contract.functions.electionDescription().call() == ELECTION_DESC

    def test_create_election_sets_election_id_to_1(self, w3, admin, voting_contract):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        assert voting_contract.functions.currentElectionId().call() == 1

    def test_create_election_emits_event(self, w3, admin, voting_contract):
        tx_hash = voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        logs = voting_contract.events.ElectionCreated().process_receipt(receipt)
        assert len(logs) == 1
        assert logs[0]["args"]["name"] == ELECTION_NAME
        assert logs[0]["args"]["electionId"] == 1

    def test_create_election_non_admin_reverts(self, voting_contract, non_admin):
        with pytest.raises(Exception):
            voting_contract.functions.createElection(
                ELECTION_NAME, ELECTION_DESC
            ).transact({"from": non_admin})

    def test_create_election_twice_reverts(self, w3, admin, voting_contract):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        with pytest.raises(Exception):
            voting_contract.functions.createElection(
                "Segunda eleicao", "Desc"
            ).transact({"from": admin})


class TestAddCandidate:
    def test_add_candidate_stores_data(self, w3, admin, voting_contract):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        voting_contract.functions.addCandidate(*CANDIDATE_A).transact({"from": admin})
        count = voting_contract.functions.getCandidateCount().call()
        assert count == 1

    def test_add_candidate_id_is_sequential(self, w3, admin, voting_contract):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        voting_contract.functions.addCandidate(*CANDIDATE_A).transact({"from": admin})
        voting_contract.functions.addCandidate(*CANDIDATE_B).transact({"from": admin})
        # candidates[0] should have id == 1
        c = voting_contract.functions.candidates(0).call()
        assert c[0] == 1  # Candidate.id

    def test_add_candidate_emits_event(self, w3, admin, voting_contract):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        tx_hash = voting_contract.functions.addCandidate(*CANDIDATE_A).transact(
            {"from": admin}
        )
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        logs = voting_contract.events.CandidateAdded().process_receipt(receipt)
        assert len(logs) == 1
        assert logs[0]["args"]["name"] == CANDIDATE_A[0]
        assert logs[0]["args"]["number"] == CANDIDATE_A[2]

    def test_add_candidate_non_admin_reverts(self, w3, admin, voting_contract, non_admin):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        with pytest.raises(Exception):
            voting_contract.functions.addCandidate(*CANDIDATE_A).transact(
                {"from": non_admin}
            )

    def test_add_candidate_duplicate_number_reverts(self, w3, admin, voting_contract):
        """Two candidates cannot share the same ballot number."""
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        voting_contract.functions.addCandidate(*CANDIDATE_A).transact({"from": admin})
        # Try to add another candidate with number 13 (same as CANDIDATE_A)
        with pytest.raises(Exception):
            voting_contract.functions.addCandidate(
                "Outro", "PL", CANDIDATE_A[2]
            ).transact({"from": admin})


class TestRegisterVoterHashes:
    def test_register_voter_hashes_stores(self, w3, admin, voting_contract):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        voting_contract.functions.registerVoterHashes(VOTER_HASHES).transact(
            {"from": admin}
        )
        stored = voting_contract.functions.getVoterHashes().call()
        assert stored == list(VOTER_HASHES)

    def test_register_voter_hashes_non_admin_reverts(
        self, w3, admin, voting_contract, non_admin
    ):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        with pytest.raises(Exception):
            voting_contract.functions.registerVoterHashes(VOTER_HASHES).transact(
                {"from": non_admin}
            )

    def test_register_voter_hashes_too_many_reverts(self, w3, admin, voting_contract):
        """17 hashes exceeds MAX_VOTERS (16) and must revert."""
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        too_many = [i + 1 for i in range(17)]
        with pytest.raises(Exception):
            voting_contract.functions.registerVoterHashes(too_many).transact(
                {"from": admin}
            )

    def test_register_voter_hashes_double_registration_reverts(
        self, w3, admin, voting_contract
    ):
        """Calling registerVoterHashes a second time must revert (idempotency guard)."""
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        voting_contract.functions.registerVoterHashes(VOTER_HASHES).transact(
            {"from": admin}
        )
        with pytest.raises(Exception):
            voting_contract.functions.registerVoterHashes(VOTER_HASHES).transact(
                {"from": admin}
            )

    def test_register_voter_hashes_zero_hash_reverts(self, w3, admin, voting_contract):
        """Any hash equal to zero must be rejected."""
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        hashes_with_zero = list(VOTER_HASHES[:5]) + [0] + list(VOTER_HASHES[6:12])
        with pytest.raises(Exception):
            voting_contract.functions.registerVoterHashes(hashes_with_zero).transact(
                {"from": admin}
            )


class TestSetMerkleRoot:
    def test_set_merkle_root_stores_value(self, w3, admin, voting_contract):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        voting_contract.functions.registerVoterHashes(VOTER_HASHES).transact(
            {"from": admin}
        )
        voting_contract.functions.setMerkleRoot(MERKLE_ROOT).transact({"from": admin})
        assert voting_contract.functions.voterMerkleRoot().call() == MERKLE_ROOT

    def test_set_merkle_root_emits_event(self, w3, admin, voting_contract):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        voting_contract.functions.registerVoterHashes(VOTER_HASHES).transact(
            {"from": admin}
        )
        tx_hash = voting_contract.functions.setMerkleRoot(MERKLE_ROOT).transact(
            {"from": admin}
        )
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        logs = voting_contract.events.MerkleRootSet().process_receipt(receipt)
        assert len(logs) == 1
        assert logs[0]["args"]["root"] == MERKLE_ROOT

    def test_set_merkle_root_without_hashes_reverts(self, w3, admin, voting_contract):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        # No registerVoterHashes call → must revert
        with pytest.raises(Exception):
            voting_contract.functions.setMerkleRoot(MERKLE_ROOT).transact(
                {"from": admin}
            )

    def test_set_merkle_root_non_admin_reverts(self, w3, admin, voting_contract, non_admin):
        voting_contract.functions.createElection(
            ELECTION_NAME, ELECTION_DESC
        ).transact({"from": admin})
        voting_contract.functions.registerVoterHashes(VOTER_HASHES).transact(
            {"from": admin}
        )
        with pytest.raises(Exception):
            voting_contract.functions.setMerkleRoot(MERKLE_ROOT).transact(
                {"from": non_admin}
            )


class TestOpenCloseElection:
    def test_open_election_sets_state_open(self, admin, pending_setup):
        pending_setup.functions.openElection().transact({"from": admin})
        assert pending_setup.functions.state().call() == 1  # OPEN

    def test_open_election_emits_event(self, w3, admin, pending_setup):
        tx_hash = pending_setup.functions.openElection().transact({"from": admin})
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        logs = pending_setup.events.ElectionOpened().process_receipt(receipt)
        assert len(logs) == 1
        assert logs[0]["args"]["electionId"] == 1

    def test_open_election_non_admin_reverts(self, admin, pending_setup, non_admin):
        with pytest.raises(Exception):
            pending_setup.functions.openElection().transact({"from": non_admin})

    def test_close_election_sets_state_finished(self, admin, election_ready):
        election_ready.functions.closeElection().transact({"from": admin})
        assert election_ready.functions.state().call() == 2  # FINISHED

    def test_close_election_emits_event(self, w3, admin, election_ready):
        tx_hash = election_ready.functions.closeElection().transact({"from": admin})
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        logs = election_ready.events.ElectionClosed().process_receipt(receipt)
        assert len(logs) == 1

    def test_close_election_non_admin_reverts(self, admin, election_ready, non_admin):
        with pytest.raises(Exception):
            election_ready.functions.closeElection().transact({"from": non_admin})
